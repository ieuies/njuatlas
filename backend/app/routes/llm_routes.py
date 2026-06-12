import json
import re

from flask import Blueprint, Response, current_app, g, jsonify, request, stream_with_context
from sqlalchemy import or_
from sqlalchemy.exc import SQLAlchemyError

from app import db
from app.auth_utils import jwt_required
from app.errors import error_response
from app.logging_utils import log_event
from app.models import ConversationMessage, Favorite, Like, Place, Review
from app.rate_limit import limiter
from app.services.amap import search_places
from app.services.guide import GUIDE_MAX_DISTANCE_M, is_excluded_guide_poi_name
from app.services.place_search import (
    collect_keyword_search_pois,
    expand_keyword_search_terms,
    sort_pois_by_keyword,
)
from app.services.llm import chat_with_llm, stream_chat_with_llm
from app.validators import clean_string, get_json_body, positive_int, validate_session_id


llm_bp = Blueprint("llm", __name__, url_prefix="/api/llm")


@llm_bp.route("/recommend_slogan", methods=["GET"])
@limiter.limit("20 per minute")
def recommend_slogan():
    place_id = positive_int(request.args.get("place_id"), "place_id")
    place = Place.query.get(place_id)
    if not place:
        return error_response("场所不存在", 404, code="place_not_found")

    reviews = Review.query.filter_by(place_id=place_id).limit(3).all()
    reviews_text = ""
    if reviews:
        reviews_text = "已有食客评价：" + "；".join([r.content for r in reviews])

    messages = [
        {
            "role": "system",
            "content": (
                "用一句不超过30字的口语评价描述这家店。"
                "语气自然，像朋友随口说的一样。"
                "禁止使用 Markdown 语法，只输出纯文本。"
                "不要用'这家店'、'它'等代词。"
            ),
        },
        {
            "role": "user",
            "content": f"店名：{place.name}\n地址：{place.address or '未知'}\n{reviews_text}\n\n用一句话评价这家店。",
        },
    ]

    try:
        slogan = chat_with_llm(messages, temperature=0.7, max_tokens=60)
        return jsonify({"place_id": place_id, "slogan": slogan})
    except Exception as exc:
        log_event(current_app.logger, "slogan_generation_failed", level="error", place_id=place_id, error=str(exc))
        return error_response("AI 生成失败", 502, code="llm_error")


def _load_conversation_history(user_id, session_id):
    limit = current_app.config["CONVERSATION_HISTORY_LIMIT"]
    rows = (
        ConversationMessage.query
        .filter_by(user_id=user_id, session_id=session_id)
        .order_by(ConversationMessage.created_at.desc(), ConversationMessage.id.desc())
        .limit(limit)
        .all()
    )
    rows.reverse()
    return [{"role": row.role, "content": row.content} for row in rows]


def _save_conversation_message(user_id, session_id, role, content):
    message = ConversationMessage(
        user_id=user_id,
        session_id=session_id,
        role=role,
        content=content,
    )
    db.session.add(message)
    return message


_MISSING_RATING = {"", "暂无评分", "无评分"}
_MISSING_COST = {"", "暂无价格"}

# 高德 POI 六位分类码 → 展示用中文（仅用于用户可见输出）
AMAP_TYPE_LABELS = {
    "050000": "餐饮",
    "050100": "中餐厅",
    "050200": "外国餐厅",
    "050300": "快餐厅",
    "050500": "冷饮店",
    "050600": "糕饼店",
    "050700": "甜品店",
    "050800": "茶餐厅",
    "050900": "甜品烘焙",
    "051000": "咖啡厅",
    "051100": "茶艺馆",
}


def _normalize_field_text(value):
    """Coerce AMap/DB scalar fields to plain strings."""
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        value = value[0] if value else ""
    if isinstance(value, dict):
        return ""
    return str(value).strip()


def _as_source_set(sources):
    if not sources:
        return set()
    if isinstance(sources, set):
        return {str(item) for item in sources}
    if isinstance(sources, (list, tuple)):
        return {str(item) for item in sources}
    return {str(sources)}


def _has_real_rating(value):
    if value is None:
        return False
    text = _normalize_field_text(value)
    return bool(text) and text not in _MISSING_RATING


def _has_real_cost(value):
    if value is None:
        return False
    text = _normalize_field_text(value)
    return bool(text) and text not in _MISSING_COST


def _format_poi_type_display(type_value):
    """Turn AMap codes / raw tags into short Chinese labels for UI."""
    if not type_value:
        return ""
    text = str(type_value).strip()
    if not text or text == "本地补充":
        return ""
    if re.fullmatch(r"\d{6}", text):
        return AMAP_TYPE_LABELS.get(text, "")
    if text.startswith("osm:"):
        return ""
    if ";" in text:
        parts = [part.strip() for part in text.split(";") if part.strip()]
        for part in reversed(parts):
            if part != "餐饮服务":
                return part
        return parts[-1] if parts else ""
    if re.fullmatch(r"\d{3,6}", text):
        return AMAP_TYPE_LABELS.get(text.zfill(6), "")
    return text


def _format_distance_text(dist_m):
    if dist_m is None:
        return ""
    d = int(dist_m)
    return f"{d}m" if d < 1000 else f"{d / 1000:.1f}km"


def _format_user_candidate_line(item, idx=None):
    """User-facing candidate line: only show fields that have real values."""
    name = item.get("name") or "未知店名"
    parts = []
    dist = (item.get("distance_text") or "").strip()
    if dist:
        parts.append(dist)
    if _has_real_rating(item.get("rating")):
        parts.append(f"评分{item.get('rating')}")
    if _has_real_cost(item.get("cost")):
        parts.append(f"人均{item.get('cost')}")
    prefix = f"{idx}. " if idx is not None else ""
    if parts:
        return f"{prefix}{name}（{'，'.join(parts)}）"
    return f"{prefix}{name}"


def _sanitize_candidate_for_api(item):
    one = dict(item)
    one.pop("rating_num", None)
    one.pop("sources", None)
    one.pop("match_level", None)
    one.pop("confidence_score", None)
    if not _has_real_rating(one.get("rating")):
        one["rating"] = ""
    if not _has_real_cost(one.get("cost")):
        one["cost"] = ""
    one["type"] = _format_poi_type_display(one.get("type"))
    return one


def _public_candidates(items):
    return [_sanitize_candidate_for_api(item) for item in (items or [])]


def _sse_event(event, payload):
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _emit_chat_recommend_response(
    *,
    stream_mode,
    session_id,
    reply=None,
    candidates=None,
    llm_messages=None,
    user_id=None,
    user_message=None,
):
    public_candidates = candidates or []

    if not stream_mode:
        return jsonify({
            "session_id": session_id,
            "reply": reply,
            "candidates": public_candidates,
        })

    @stream_with_context
    def generate():
        yield _sse_event("meta", {
            "session_id": session_id,
            "candidates": public_candidates,
        })

        if llm_messages is not None:
            parts = []
            try:
                _save_conversation_message(user_id, session_id, "user", user_message)
                db.session.commit()
                for chunk in stream_chat_with_llm(llm_messages, temperature=0.7, max_tokens=500):
                    parts.append(chunk)
                    yield _sse_event("token", {"text": chunk})
                full_reply = "".join(parts)
                _save_conversation_message(user_id, session_id, "assistant", full_reply)
                db.session.commit()
                log_event(
                    current_app.logger,
                    "conversation_turn_saved",
                    user_id=user_id,
                    session_id=session_id,
                    streamed=True,
                )
                yield _sse_event("done", {"reply": full_reply})
            except Exception as exc:
                db.session.rollback()
                log_event(
                    current_app.logger,
                    "chat_recommend_stream_failed",
                    level="error",
                    user_id=user_id,
                    error=str(exc),
                )
                if isinstance(exc, SQLAlchemyError):
                    message = "数据库操作失败。"
                else:
                    message = "AI 回复失败"
                yield _sse_event("error", {"message": message})
            return

        text = reply or ""
        step = 18
        for i in range(0, len(text), step):
            yield _sse_event("token", {"text": text[i:i + step]})
        yield _sse_event("done", {"reply": text})

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


_LLM_AREA_ONLY_KEYWORDS = {
    "仙林", "鼓楼", "浦口", "南京大学", "南大", "新街口", "夫子庙",
    "汉口路", "珠江路", "南门", "北门",
}

_LLM_SHOP_KEYWORD_STRIP_WORDS = [
    "附近", "周边", "一带", "推荐", "一些", "有什么", "有", "吗", "呢", "去",
    "帮我", "能不能", "可以", "给我", "啥", "什么", "哪里", "哪些",
    "好吃的", "吃的", "附近有", "推荐一下", "吃啥", "吃啥呢",
    "吃什么", "吃点啥", "去哪吃", "去哪", "去哪儿吃",
    "有好吃的", "有什么好吃的", "有啥好吃的",
    "有推荐的", "有推荐吗", "推荐吗",
    "想吃什么", "想吃啥", "想吃点",
    "叫外卖", "外卖", "今天", "今晚", "中午", "晚上",
    "吃", "喝", "是", "的", "了", "呀", "吧", "啊",
    "鼓楼校区", "仙林校区", "浦口校区", "仙林大学城",
    "汉口路", "珠江路", "鼓楼", "仙林", "浦口", "新街口", "夫子庙",
    "南门", "北门", "南大", "南京大学", "校区",
    "餐厅", "美食", "小吃", "饭馆", "饭店", "店铺", "好吃", "饿了",
    "如何", "怎么样", "怎样", "好不好", "咋样", "靠谱吗", "值得去吗", "可以吗", "行不行",
]

_LLM_DEFAULT_CAMPUS_LOCATION = "118.780,32.058"

_SHOP_INQUIRY_SUFFIX_RE = re.compile(
    r"(如何|怎么样|怎样|好不好|咋样|靠谱吗|值得去吗|可以吗|行不行)$"
)


def _resolve_shop_search_keywords(message, area_only_keywords=None):
    """从用户消息提取店名/品牌检索词，避免「南大附近李记」被降成泛搜「美食」。"""
    area_only_keywords = area_only_keywords or _LLM_AREA_ONLY_KEYWORDS
    msg = (message or "").strip()
    if not msg:
        return []

    keywords = []
    seen = set()

    def _add(kw):
        kw = (kw or "").strip()
        if len(kw) < 2 or kw in area_only_keywords:
            return
        key = kw.lower()
        if key in seen:
            return
        seen.add(key)
        keywords.append(kw)

    clean = msg
    for word in sorted(_LLM_SHOP_KEYWORD_STRIP_WORDS, key=len, reverse=True):
        clean = clean.replace(word, " ")
    _add(" ".join(clean.split()).strip())

    for part in re.split(r"[，,。！？!?、；;\s]+", msg):
        part = part.strip()
        if len(part) < 2:
            continue
        normalized = part
        for word in sorted(_LLM_SHOP_KEYWORD_STRIP_WORDS, key=len, reverse=True):
            normalized = normalized.replace(word, " ")
        normalized = " ".join(normalized.split()).strip()
        if normalized:
            _add(normalized)
        elif part not in _LLM_SHOP_KEYWORD_STRIP_WORDS and part not in area_only_keywords:
            _add(part)

    return keywords[:4]


def _is_shop_inquiry_message(message):
    return bool(_SHOP_INQUIRY_SUFFIX_RE.search((message or "").strip()))


def _candidate_matches_shop_keywords(candidate, shop_keywords):
    name = (candidate.get("name") or "").strip().lower()
    if not name:
        return False
    for kw in shop_keywords or []:
        token = (kw or "").strip().lower()
        if len(token) < 2:
            continue
        if token in name or name in token:
            return True
        if len(token) >= 2 and token[:2] in name:
            return True
    return False


def _format_llm_candidate_line(candidate, index):
    """LLM context line: omit missing rating/cost and internal source tags."""
    dist_text = f"距离约{candidate['distance_text']}，" if candidate.get("distance_text") else ""
    rating_part = f"评分{candidate['rating']} - " if _has_real_rating(candidate.get("rating")) else ""
    cost_part = f"人均{candidate['cost']} - " if _has_real_cost(candidate.get("cost")) else ""
    type_label = _format_poi_type_display(candidate.get("type"))
    type_part = f"分类：{type_label} - " if type_label else ""
    return (
        f"{index}. {candidate['name']} - {candidate['address']} - "
        f"{dist_text}{rating_part}{cost_part}{type_part}".rstrip(" - ") + "\n"
    )


@llm_bp.route("/chat_recommend", methods=["POST"])
@jwt_required
@limiter.limit("10 per minute")
def chat_recommend():
    data = get_json_body(request)
    user_message = clean_string(data.get("message"), "message", required=True, max_length=500)
    session_id = validate_session_id(data.get("session_id")) or ConversationMessage.new_session_id()
    city = clean_string(data.get("city", "南京"), "city", required=True, max_length=50)
    stream_mode = bool(data.get("stream"))

    user_id = g.current_user_id
    history = _load_conversation_history(user_id, session_id)

    liked = Like.query.filter_by(user_id=user_id).limit(10).all()
    favorited = Favorite.query.filter_by(user_id=user_id).limit(10).all()

    place_names = set()
    for item in liked:
        place_names.add(item.place.name)
    for item in favorited:
        place_names.add(item.place.name)

    preference_text = ""
    if place_names:
        preference_text = "这位用户喜欢的场所有：" + "、".join(list(place_names)[:5]) + "。"

    # 意图判断：只有用户明确在找餐厅时才去高德搜索
    food_keywords = [
        "吃", "饭", "餐厅", "美食", "推荐", "好吃", "饿了", "夜宵", "早餐",
        "午餐", "晚餐", "川菜", "湘菜", "火锅", "烧烤", "咖啡", "奶茶",
        "外卖", "堂食", "食堂", "哪家", "哪里", "什么店", "有啥", "有没有",
        "菜单", "点菜", "请客", "聚餐", "约会", "小吃", "甜点", "面包",
        "饺子", "面", "饭馆", "菜馆", "好喝",
        "附近", "周边", "旁边", "一带", "附近有", "去吃点",
        "去吃", "吃的", "吃东西", "吃的啥", "吃啥",
        "有什么好吃的", "有什么吃的", "有推荐的",
    ]
    is_food_request = any(kw in user_message.lower() for kw in food_keywords)

    # 兜底：消息中同时含有「推荐」+ 南大地点词也视为美食请求
    location_keywords = ["鼓楼", "仙林", "浦口", "南大", "校区", "南门", "北门", "汉口路", "珠江路"]
    if not is_food_request:
        if "推荐" in user_message.lower() and any(loc in user_message for loc in location_keywords):
            is_food_request = True

    shop_search_keywords = expand_keyword_search_terms(
        _resolve_shop_search_keywords(user_message)
    )
    if shop_search_keywords or _is_shop_inquiry_message(user_message):
        is_food_request = True

    # 细分餐饮类型映射：按关键词长度降序排列（越长越优先匹配）
    # 高德 POI 分类码参考：
    #   050000=餐饮, 050100=中餐厅, 050200=外国餐厅, 050300=快餐厅,
    #   050500=冷饮店, 050600=糕饼店, 050700=甜品店, 050800=茶餐厅,
    #   051000=咖啡厅, 051100=茶艺馆
    FOOD_TYPE_MAP = [
        # 饮品（优先长关键词）
        # 奶茶门店在高德里常落在 050500(冷饮店) 或 050700(甜品店)
        ("奶茶", "050500|050700"),
        ("茶饮", "050500|050700"),
        ("饮品", "050500|050700"),
        ("咖啡", "051000"),      # 咖啡厅
        ("好喝", "050500|050700"),      # 冷饮/甜品饮品混合场景
        # 甜点烘焙
        ("甜品", "050700"),      # 甜品店
        ("甜点", "050700"),
        ("面包", "050600"),      # 糕饼店
        ("蛋糕", "050600"),
        # 正餐细分
        ("火锅", "050100"),      # 中餐厅
        ("烧烤", "050100"),
        ("川菜", "050100"),
        ("湘菜", "050100"),
        ("粤菜", "050100"),
        ("麻辣烫", "050100"),
        ("麻辣", "050100"),
        ("饺子", "050100"),
        ("面馆", "050100"),
        ("面食", "050100"),
        ("饭馆", "050100"),
        ("菜馆", "050100"),
        ("日料", "050200"),      # 外国餐厅
        ("韩餐", "050200"),
        ("韩料", "050200"),
        ("西餐", "050200"),
        # 快餐小吃
        ("快餐", "050300"),      # 快餐厅
        ("小吃", "050300"),      # 快餐厅
        ("夜宵", "050300"),
        ("早餐", "050300"),
        ("午餐", "050300"),
        ("晚餐", "050300"),
        ("食堂", "050300"),
        # 茶餐厅
        ("茶餐厅", "050800"),    # 茶餐厅
        ("港式", "050800"),
    ]
    # 按关键词长度降序排列："茶餐厅" 比 "餐厅" 先匹配
    FOOD_TYPE_MAP.sort(key=lambda x: len(x[0]), reverse=True)

    def _resolve_food_type(message):
        """根据用户消息中的细分关键词，返回精确的高德 POI 类型码。
        未命中任何细分词时返回默认大类 '050000'。
        """
        msg_lower = message.lower()
        for keyword, type_code in FOOD_TYPE_MAP:
            if keyword in msg_lower:
                return type_code
        return "050000"

    def _resolve_food_focus_keyword(message):
        """提取用户消息中的餐饮焦点词，用于增强高德检索关键词。"""
        msg_lower = message.lower()
        focus_keywords = [
            ("饺子馆", "饺子"),
            ("饺子", "饺子"),
            ("水饺", "饺子"),
            ("面馆", "面馆"),
            ("面食", "面"),
            ("火锅", "火锅"),
            ("烧烤", "烧烤"),
            ("川菜", "川菜"),
            ("湘菜", "湘菜"),
            ("粤菜", "粤菜"),
            ("西餐", "西餐"),
            ("日料", "日料"),
            ("韩餐", "韩餐"),
            ("咖啡厅", "咖啡"),
            ("咖啡", "咖啡"),
            ("奶茶店", "奶茶"),
            ("奶茶", "奶茶"),
            ("甜品", "甜品"),
            ("甜点", "甜品"),
            ("小吃", "小吃"),
        ]
        for keyword, normalized in focus_keywords:
            if keyword in msg_lower:
                return normalized
        return ""

    def _resolve_search_keyword(message):
        """从用户消息中提取更适合高德搜索的地点关键词。
        例如 '鼓楼校区附近推荐一些' → '鼓楼'
        """
        food_focus = _resolve_food_focus_keyword(message)
        area_keywords = sorted([
            ("汉口路", "汉口路"),
            ("珠江路", "珠江路"),
            ("鼓楼校区", "鼓楼"),
            ("仙林校区", "仙林"),
            ("鼓楼", "鼓楼"),
            ("仙林", "仙林"),
            ("浦口", "浦口"),
            ("南大", "南京大学"),
            ("新街口", "新街口"),
            ("夫子庙", "夫子庙"),
            ("南门", "南门"),
            ("北门", "北门"),
        ], key=lambda x: len(x[0]), reverse=True)
        for kw, replacement in area_keywords:
            if kw in message:
                return f"{replacement}{food_focus}" if food_focus else f"{replacement}"
        # 如果没有地名关键词，去掉无意义噪音词
        noise_words = [
            "附近", "周边", "一带", "推荐", "一些", "有什么", "有", "吗", "呢", "去",
            "帮我", "能不能", "可以", "给我", "啥", "什么", "哪里", "哪些",
            "好吃的", "吃的", "附近有", "推荐一下", "吃啥", "吃啥呢",
            "吃什么", "吃点啥", "去哪吃", "去哪", "去哪儿吃",
            "有好吃的", "有什么好吃的", "有啥好吃的",
            "有推荐的", "有推荐吗", "推荐吗",
            "想吃什么", "想吃啥", "想吃点",
            "叫外卖", "外卖", "附近的外卖",
            "今天", "今晚", "中午", "晚上",
            "吃", "喝", "是", "的", "了", "呀", "吧", "啊",
        ]
        clean = message
        for noise in sorted(noise_words, key=len, reverse=True):
            clean = clean.replace(noise, " ")
        clean = " ".join(clean.split()).strip()
        if len(clean) >= 2:
            return clean
        if food_focus:
            return food_focus
        return message

    def _resolve_name_constraints(message):
        """提取用户明确表达的品类约束（用于候选硬过滤和兜底策略）。"""
        if not message:
            return []
        msg_lower = message.lower()
        # 长词优先匹配，避免“饺子馆”先命中“饺子”导致约束被放宽。
        name_keywords = [
            ("面包房", ["面包", "烘焙", "糕饼"]),
            ("咖啡厅", ["咖啡", "coffee"]),
            ("饺子馆", ["饺子", "水饺", "煎饺", "云饺"]),
            ("面馆", ["面", "面条", "拉面", "燃面", "拌面", "汤面"]),
            ("面食", ["面", "面条", "拉面", "燃面", "拌面", "汤面"]),
            ("面包", ["面包", "烘焙", "糕饼"]),
            ("咖啡", ["咖啡", "coffee"]),
            ("奶茶", ["奶茶", "茶饮", "饮品"]),
            ("火锅", ["火锅", "焖锅"]),
            ("饺子", ["饺子", "水饺", "煎饺", "云饺"]),
            ("川菜", ["川菜", "麻辣"]),
            ("西餐", ["西餐", "牛排", "披萨", "意面", "沙拉", "brunch", "汉堡", "炸鸡", "轻食"]),
            ("日料", ["日料", "日本", "寿司", "刺身", "居酒屋", "拉面", "日式"]),
            ("韩餐", ["韩餐", "韩国", "韩式", "烤肉", "拌饭"]),
            ("烧烤", ["烧烤", "烤串", "烤肉", "烧肉"]),
            ("甜品", ["甜品", "甜点", "蛋糕"]),
            ("甜点", ["甜品", "甜点", "蛋糕"]),
            ("小吃", ["小吃", "炸", "串"]),
        ]
        for nk, values in name_keywords:
            if nk in msg_lower:
                return values
        return []

    def _type_matches_search(message, name, type_str):
        """根据用户消息中的食物关键词、POI 名称和高德 type 字段，判断该 POI 是否匹配。
        返回 True 表示匹配（应保留），False 表示不匹配（应过滤掉）。
        判断逻辑：如果用户消息中有明确的类型关键词（如面馆、西餐等），
        则要求候选的名称中也包含相应的关键词才能通过。type 仅作辅助参考。
        """
        if not type_str:
            return True  # 没有 type 信息时不过滤，让 AI 自己判断
        if not message:
            return True
        msg_lower = message.lower()
        name_lower = name.lower()
        name_constraints = _resolve_name_constraints(message)

        # 从 FOOD_TYPE_MAP 中找到匹配的关键词
        matched_keyword = None
        for keyword, type_code in FOOD_TYPE_MAP:
            if keyword in msg_lower:
                matched_keyword = keyword
                break

        if matched_keyword is None:
            return True  # 没有匹配到 FOOD_TYPE_MAP 关键词，不过滤

        # 用户表达了明确品类时，默认名称要命中约束词。
        if name_constraints:
            if any(token in name_lower for token in name_constraints):
                return True

            # 奶茶/茶饮场景：不少门店名称不直接包含“奶茶”字样，
            # 但高德分类已是冷饮/甜品/茶饮类，这里允许按分类通过。
            beverage_query = any(k in msg_lower for k in ("奶茶", "茶饮", "饮品"))
            if beverage_query:
                type_lower = (type_str or "").lower()
                beverage_type_markers = ("冷饮店", "甜品店", "050500", "050700")
                coffee_markers = ("咖啡", "051000")
                if any(marker.lower() in type_lower for marker in beverage_type_markers):
                    # 奶茶查询不把纯咖啡类门店混进来
                    if not any(marker.lower() in type_lower for marker in coffee_markers):
                        return True
            return False

        # 没有在 name_keywords 中匹配到，但 FOOD_TYPE_MAP 匹配了（如"餐厅"等泛关键词）
        # 此时不过滤，让 AI 根据完整信息判断
        return True

    candidates = []
    strict_candidates = []
    relaxed_candidates = []
    candidates_text = ""
    if is_food_request:
        user_location_raw = clean_string(data.get("location"), "location", max_length=50)

        # 硬过滤半径（米）
        MAX_DISTANCE_M = 5000

        from math import radians, cos, sin, asin, sqrt

        def haversine(lng1, lat1, lng2, lat2):
            """球面距离，单位米。"""
            lng1, lat1, lng2, lat2 = map(radians, [lng1, lat1, lng2, lat2])
            dlng = lng2 - lng1
            dlat = lat2 - lat1
            a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlng / 2) ** 2
            return 2 * 6371000 * asin(sqrt(a))

        def _parse_loc(loc: str):
            if not loc or "," not in loc:
                return None, None
            try:
                lng_s, lat_s = loc.split(",", 1)
                return float(lng_s), float(lat_s)
            except (ValueError, TypeError):
                return None, None

        # 浏览器定位：用于展示“你到这里有多远”；检索排序用校区锚点。
        gps_lng = gps_lat = None
        if user_location_raw:
            gps_lng, gps_lat = _parse_loc(user_location_raw)

        def _distance_from(lng, lat, poi_loc):
            if lng is None or not poi_loc:
                return None
            plng, plat = _parse_loc(poi_loc)
            if plng is None:
                return None
            return int(haversine(lng, lat, plng, plat))

        # 根据用户消息中的细分关键词，选择精确的高德 POI 类型
        search_types = _resolve_food_type(user_message)
        search_keyword = _resolve_search_keyword(user_message)
        food_focus_keyword = _resolve_food_focus_keyword(user_message)
        strict_tokens = _resolve_name_constraints(user_message)

        AREA_ONLY_KEYWORDS = _LLM_AREA_ONLY_KEYWORDS

        def _has_empty_result(result):
            return (
                result.get("status") == "0"
                or (result.get("status") == "1" and not result.get("pois"))
            )

        def _resolve_area_anchor(message):
            # 长词优先，避免“南大仙林校区”误命中“南大”落到鼓楼。
            anchor_map = sorted([
                ("仙林校区", "118.90840,32.11720"),
                ("鼓楼校区", "118.78070,32.05720"),
                ("浦口校区", "118.63380,32.05960"),
                ("仙林大学城", "118.93021,32.10247"),
                ("汉口路", "118.78070,32.05720"),
                ("珠江路", "118.78472,32.03517"),
                ("仙林", "118.90840,32.11720"),
                ("鼓楼", "118.78070,32.05720"),
                ("浦口", "118.63380,32.05960"),
                ("新街口", "118.78472,32.03517"),
                ("夫子庙", "118.78811,32.02056"),
                ("南大", "118.78070,32.05720"),
            ], key=lambda item: len(item[0]), reverse=True)
            for key, loc in anchor_map:
                if key in message:
                    return loc
            return None

        def _resolve_area_label(message):
            label_map = sorted([
                ("仙林校区", "仙林校区"),
                ("鼓楼校区", "鼓楼校区"),
                ("浦口校区", "浦口校区"),
                ("仙林大学城", "仙林大学城"),
                ("汉口路", "鼓楼校区一带"),
                ("珠江路", "珠江路一带"),
                ("仙林", "仙林"),
                ("鼓楼", "鼓楼"),
                ("浦口", "浦口"),
                ("新街口", "新街口"),
                ("夫子庙", "夫子庙"),
            ], key=lambda item: len(item[0]), reverse=True)
            for key, label in label_map:
                if key in message:
                    return label
            return None

        def _campus_affinity_bonus(name, address):
            """用户问南大时，优先南大周边而非南师大等邻近高校。"""
            text = f"{name or ''} {address or ''}".lower()
            bonus = 0.0
            if "南大" in user_message or "南京大学" in user_message:
                if "南京大学" in text or "南大" in text:
                    bonus += 0.15
                if "师范大学" in text or "南师大" in text or "师大" in text:
                    bonus -= 0.2
            if "仙林" in user_message:
                if any(marker in text for marker in ("仙林", "学林", "文苑", "羊山")):
                    bonus += 0.05
            if "鼓楼" in user_message:
                if any(marker in text for marker in ("鼓楼", "汉口路", "广州路", "金银街")):
                    bonus += 0.05
            return bonus

        def _resolve_around_keyword():
            """周边检索用词：优先店名/品牌，其次餐饮词，不用纯地名。"""
            if shop_search_keywords:
                return shop_search_keywords[0]
            if food_focus_keyword:
                return food_focus_keyword
            if strict_tokens:
                return strict_tokens[0]
            if search_keyword and search_keyword not in AREA_ONLY_KEYWORDS:
                return search_keyword
            return "美食"

        def _is_food_category(category):
            if not category:
                return True
            if category.startswith("osm:"):
                return True
            return category.startswith("05")

        def _collect_amap_pois(results):
            seen = set()
            pois = []
            for result in results:
                if str(result.get("status")) != "1":
                    continue
                for poi in result.get("pois", []) or []:
                    poi_id = str(poi.get("id") or "").strip()
                    name = str(poi.get("name") or "").strip().lower()
                    loc = str(poi.get("location") or "").strip()
                    key = poi_id or f"{name}|{loc}"
                    if not key or key in seen:
                        continue
                    seen.add(key)
                    pois.append(poi)
            return pois

        def _append_around_search(results, keyword, location, types_code="050000", page_size=25):
            page_size = min(int(page_size or 25), 25)
            results.append(
                search_places(
                    keyword,
                    location=location,
                    radius=MAX_DISTANCE_M,
                    page=1,
                    page_size=page_size,
                    types=types_code or None,
                    sortrule="distance" if types_code else "weight",
                )
            )

        message_anchor = _resolve_area_anchor(user_message)
        search_area_label = _resolve_area_label(user_message)
        search_location = message_anchor or user_location_raw
        if not search_location and shop_search_keywords:
            search_location = _LLM_DEFAULT_CAMPUS_LOCATION
            search_area_label = search_area_label or "鼓楼校区"
        rank_lng = rank_lat = None
        if message_anchor:
            rank_lng, rank_lat = _parse_loc(message_anchor)
        elif gps_lng is not None:
            rank_lng, rank_lat = gps_lng, gps_lat
        elif search_location:
            rank_lng, rank_lat = _parse_loc(search_location)

        around_keyword = _resolve_around_keyword()
        amap_pois = []

        if shop_search_keywords:
            search_loc = search_location or _LLM_DEFAULT_CAMPUS_LOCATION
            if rank_lng is None:
                rank_lng, rank_lat = _parse_loc(search_loc)
            if not search_area_label:
                search_area_label = "鼓楼校区"
            guide_pois = collect_keyword_search_pois(
                shop_search_keywords[0],
                city=city,
                location=search_loc,
                extra_terms=shop_search_keywords,
            )
            amap_pois = sort_pois_by_keyword(guide_pois, shop_search_keywords[0])
        else:
            amap_results = []
            if search_location:
                _append_around_search(amap_results, around_keyword, search_location, search_types)
                if search_types != "050000" and _has_empty_result(amap_results[-1]):
                    _append_around_search(amap_results, around_keyword, search_location, "050000")
                if not strict_tokens:
                    if around_keyword != "餐厅":
                        _append_around_search(amap_results, "餐厅", search_location, "050000")
                    if around_keyword != "小吃":
                        _append_around_search(amap_results, "小吃", search_location, "050000")
                if "仙林" in user_message:
                    xianlin_extra = "118.93021,32.10247"
                    if xianlin_extra != search_location:
                        _append_around_search(amap_results, around_keyword, xianlin_extra, "050000")
            else:
                city_primary = search_places(
                    search_keyword or around_keyword,
                    city=city,
                    page=1,
                    page_size=25,
                    types=search_types,
                )
                amap_results.append(city_primary)
                if search_types != "050000" and _has_empty_result(city_primary):
                    amap_results.append(
                        search_places(
                            search_keyword or around_keyword,
                            city=city,
                            page=1,
                            page_size=25,
                            types="050000",
                        )
                    )

            if strict_tokens and food_focus_keyword and food_focus_keyword not in (search_keyword or ""):
                amap_results.append(
                    search_places(
                        food_focus_keyword,
                        city=city,
                        page=1,
                        page_size=25,
                        types=search_types,
                    )
                )

            amap_pois = _collect_amap_pois(amap_results)
            if strict_tokens and not amap_pois and food_focus_keyword:
                amap_results.append(
                    search_places(
                        food_focus_keyword,
                        city=city,
                        page=1,
                        page_size=25,
                        types="050000",
                    )
                )
                amap_pois = _collect_amap_pois(amap_results)

        raw_candidates = []

        # 渠道1：高德实时 POI（基准数据源）
        for poi in amap_pois:
                poi_name = _normalize_field_text(poi.get("name", ""))
                if is_excluded_guide_poi_name(poi_name):
                    continue

                poi_loc = poi.get("location", "")
                dist_m = _distance_from(rank_lng, rank_lat, poi_loc)

                # 硬过滤：按检索锚点半径筛选（与展示用的 GPS 距离无关）
                max_dist = GUIDE_MAX_DISTANCE_M if shop_search_keywords else MAX_DISTANCE_M
                if rank_lng is not None and (dist_m is None or dist_m > max_dist):
                    continue

                biz_ext = poi.get("biz_ext") or {}
                if not isinstance(biz_ext, dict):
                    biz_ext = {}
                raw_rating = _normalize_field_text(biz_ext.get("rating", ""))
                raw_cost = _normalize_field_text(biz_ext.get("cost", ""))
                rating_num = None
                if _has_real_rating(raw_rating):
                    try:
                        rating_num = float(raw_rating)
                    except (ValueError, TypeError):
                        pass

                raw_candidates.append({
                    "name": poi_name or "未知",
                    "address": _normalize_field_text(poi.get("address", "未知")) or "未知",
                    "location": poi_loc,
                    "type": _normalize_field_text(poi.get("type", "")),
                    "rating": raw_rating or "暂无评分",
                    "cost": raw_cost or "暂无价格",
                    "distance_m": dist_m,
                    "display_distance_m": _distance_from(gps_lng, gps_lat, poi_loc) or dist_m,
                    "rating_num": rating_num,
                    "sources": {"amap"},
                })

        def _bbox_for_radius(lng, lat, radius_m):
            from math import cos, radians
            lat_delta = radius_m / 111_320.0
            lng_delta = radius_m / (111_320.0 * max(cos(radians(lat)), 0.2))
            return lng - lng_delta, lng + lng_delta, lat - lat_delta, lat + lat_delta

        def _places_in_bbox(min_lng, max_lng, min_lat, max_lat, limit=400):
            bind = db.session.get_bind()
            dialect = bind.dialect.name if bind else "sqlite"
            params = {
                "min_lng": min_lng,
                "max_lng": max_lng,
                "min_lat": min_lat,
                "max_lat": max_lat,
                "limit": limit,
            }
            if dialect == "sqlite":
                sql = """
                    SELECT id FROM places
                    WHERE location IS NOT NULL
                    AND CAST(substr(location, 1, instr(location, ',') - 1) AS REAL)
                        BETWEEN :min_lng AND :max_lng
                    AND CAST(substr(location, instr(location, ',') + 1) AS REAL)
                        BETWEEN :min_lat AND :max_lat
                    LIMIT :limit
                """
            elif dialect.startswith("postgres"):
                sql = """
                    SELECT id FROM places
                    WHERE location IS NOT NULL
                    AND CAST(split_part(location, ',', 1) AS double precision)
                        BETWEEN :min_lng AND :max_lng
                    AND CAST(split_part(location, ',', 2) AS double precision)
                        BETWEEN :min_lat AND :max_lat
                    LIMIT :limit
                """
            else:
                return Place.query.filter(Place.location.isnot(None)).limit(limit).all()
            from sqlalchemy import text
            ids = [row[0] for row in db.session.execute(text(sql), params).fetchall()]
            if not ids:
                return []
            return Place.query.filter(Place.id.in_(ids)).all()

        # 渠道2：本地沉淀库（用户互动 + OSM 导入等）
        if not shop_search_keywords:
            search_terms = []
            if search_keyword:
                search_terms.extend([t for t in re.split(r"\s+", search_keyword) if len(t) >= 2])
            search_terms.extend(strict_tokens[:4])
            # 去重并限制数量，避免 SQL 条件过大
            dedup_terms = []
            seen_terms = set()
            for term in search_terms:
                key = term.strip().lower()
                if not key or key in seen_terms:
                    continue
                seen_terms.add(key)
                dedup_terms.append(term.strip())
                if len(dedup_terms) >= 6:
                    break

            local_query = Place.query
            if dedup_terms:
                like_conditions = []
                for term in dedup_terms:
                    pattern = f"%{term}%"
                    like_conditions.append(Place.name.ilike(pattern))
                    like_conditions.append(Place.address.ilike(pattern))
                    like_conditions.append(Place.category.ilike(pattern))
                local_query = local_query.filter(or_(*like_conditions))

            local_places = []
            seen_local_ids = set()
            if rank_lng is not None:
                min_lng, max_lng, min_lat, max_lat = _bbox_for_radius(
                    rank_lng, rank_lat, MAX_DISTANCE_M
                )
                geo_hits = []
                for place in _places_in_bbox(min_lng, max_lng, min_lat, max_lat):
                    if not _is_food_category(place.category):
                        continue
                    dist_m = _distance_from(rank_lng, rank_lat, place.location)
                    if dist_m is None or dist_m > MAX_DISTANCE_M:
                        continue
                    geo_hits.append((dist_m, place))
                geo_hits.sort(key=lambda item: item[0])
                for _, place in geo_hits[:120]:
                    local_places.append(place)
                    seen_local_ids.add(place.id)

            text_places = local_query.order_by(Place.id.desc()).limit(120).all()
            for place in text_places:
                if place.id not in seen_local_ids:
                    local_places.append(place)
                    seen_local_ids.add(place.id)

            for place in local_places:
                if is_excluded_guide_poi_name(place.name):
                    continue
                poi_loc = (place.location or "").strip()
                dist_m = _distance_from(rank_lng, rank_lat, poi_loc)
                if rank_lng is not None and (dist_m is None or dist_m > MAX_DISTANCE_M):
                    continue
                raw_candidates.append({
                    "name": place.name or "未知",
                    "address": place.address or "未知",
                    "location": poi_loc,
                    "type": place.category or "本地补充",
                    "rating": "暂无评分",
                    "cost": "暂无价格",
                    "distance_m": dist_m,
                    "display_distance_m": _distance_from(gps_lng, gps_lat, poi_loc) or dist_m,
                    "rating_num": None,
                    "sources": {"local_db"},
                })

        # 多源去重并合并证据
        merged = {}
        for c in raw_candidates:
            name_key = (c.get("name") or "").strip().lower()
            loc_key = (c.get("location") or "").strip()
            plng, plat = _parse_loc(loc_key)
            if plng is not None:
                key = f"{name_key}|{round(plng, 4)},{round(plat, 4)}"
            else:
                key = name_key
            if key not in merged:
                merged[key] = dict(c)
                merged[key]["sources"] = _as_source_set(c.get("sources"))
                continue

            existing = merged[key]
            existing["sources"].update(_as_source_set(c.get("sources")))
            if not _has_real_rating(existing.get("rating")) and _has_real_rating(c.get("rating")):
                existing["rating"] = _normalize_field_text(c.get("rating"))
                existing["rating_num"] = c.get("rating_num")
            if not _has_real_cost(existing.get("cost")) and _has_real_cost(c.get("cost")):
                existing["cost"] = _normalize_field_text(c.get("cost"))
            # 优先保留高德 type（通常更规范）
            if (existing.get("type") or "").startswith("osm:") and c.get("type") and not c.get("type", "").startswith("osm:"):
                existing["type"] = c.get("type")
            if existing.get("distance_m") is None and c.get("distance_m") is not None:
                existing["distance_m"] = c.get("distance_m")
            if existing.get("display_distance_m") is None and c.get("display_distance_m") is not None:
                existing["display_distance_m"] = c.get("display_distance_m")

        raw_candidates = list(merged.values())

        # 综合评分排序：距离 + 评分 + 多源证据加权
        def _candidate_score(c):
            dist_score = 0.0
            if c["distance_m"] is not None:
                dist_score = max(0.0, 1.0 - c["distance_m"] / MAX_DISTANCE_M)
            rating_score = 0.5
            if c["rating_num"] is not None:
                rating_score = min(c["rating_num"], 5.0) / 5.0
            source_bonus = min(0.15, 0.08 * max(0, len(c.get("sources") or []) - 1))
            source_quality_bonus = 0.0
            sources = c.get("sources") or set()
            if "amap" in sources:
                source_quality_bonus += 0.12
            if "local_db" in sources and "amap" in sources:
                source_quality_bonus += 0.03
            name_bonus = 0.0
            if strict_tokens and any(tok in (c.get("name") or "").lower() for tok in strict_tokens):
                name_bonus = 0.1
            shop_name_bonus = 0.0
            if shop_search_keywords and _candidate_matches_shop_keywords(c, shop_search_keywords):
                shop_name_bonus = 0.25
            campus_bonus = _campus_affinity_bonus(c.get("name"), c.get("address"))
            return (
                dist_score * 0.5 + rating_score * 0.35 + source_bonus
                + source_quality_bonus + name_bonus + shop_name_bonus + campus_bonus
            )

        raw_candidates.sort(key=_candidate_score, reverse=True)

        def _build_candidate(c, match_level):
            show_dist = c.get("display_distance_m")
            if show_dist is None:
                show_dist = c.get("distance_m")
            dist_str = _format_distance_text(show_dist)
            return {
                "name": c["name"],
                "address": c["address"],
                "location": c["location"],
                "type": c["type"],
                "rating": c["rating"],
                "rating_num": c["rating_num"],
                "cost": c["cost"],
                "distance_text": dist_str,
                "sources": sorted(c.get("sources") or []),
                "match_level": match_level,  # strict / relaxed
                "confidence_score": round(_candidate_score(c), 3),
            }

        has_strict_constraint = bool(strict_tokens)
        strict_pool = []
        relaxed_pool = []
        if has_strict_constraint:
            for c in raw_candidates:
                if _type_matches_search(user_message, c["name"], c["type"]):
                    strict_pool.append(_build_candidate(c, "strict"))
                else:
                    relaxed_pool.append(_build_candidate(c, "relaxed"))
        else:
            # 泛需求：第一层直接取综合排序前列
            strict_pool = [_build_candidate(c, "strict") for c in raw_candidates]

        # 明确品类场景下，若高德已有命中，则优先保留高德候选，
        # 并降级/剔除无评分无价格的本地占位项，避免“看起来没用高德”。
        if has_strict_constraint and strict_pool:
            amap_first = [c for c in strict_pool if "amap" in (c.get("sources") or [])]
            local_only = [c for c in strict_pool if "amap" not in (c.get("sources") or [])]
            if amap_first:
                strong_local = [
                    c for c in local_only
                    if _has_real_rating(c.get("rating")) or _has_real_cost(c.get("cost"))
                ]
                # 当高德命中较少时，补充一部分本地候选，避免只显示 1 家。
                if len(amap_first) + len(strong_local) < 3:
                    strong_ids = {id(c) for c in strong_local}
                    weak_local = [c for c in local_only if id(c) not in strong_ids]
                    need = 3 - (len(amap_first) + len(strong_local))
                    if need > 0:
                        strong_local.extend(weak_local[:need])
                strict_pool = (amap_first + strong_local)

        strict_candidates = strict_pool[:5]
        if has_strict_constraint:
            # 第二层：扩展备选（只在严格不足时补齐，且优先高德）
            if len(strict_candidates) < 3 and relaxed_pool:
                amap_relaxed = [c for c in relaxed_pool if "amap" in (c.get("sources") or [])]
                local_relaxed = [c for c in relaxed_pool if "amap" not in (c.get("sources") or [])]
                need = min(3 - len(strict_candidates), 3)
                relaxed_candidates = (amap_relaxed + local_relaxed)[:need]
        else:
            relaxed_candidates = []

        # “值得去”语义：不做高门槛，仅剔除低于 3 分的店；无评分先保留。
        if (strict_candidates or relaxed_candidates) and ("值得去" in user_message or "值得" in user_message):
            worth_filtered = [
                c for c in (strict_candidates + relaxed_candidates)
                if c.get("rating_num") is None or c.get("rating_num", 0) >= 3.0
            ]
            if worth_filtered:
                strict_candidates = [c for c in worth_filtered if c.get("match_level") == "strict"]
                relaxed_candidates = [c for c in worth_filtered if c.get("match_level") == "relaxed"]

        candidates = (strict_candidates + relaxed_candidates)[:5]

        if candidates:
            if has_strict_constraint:
                candidates_text = "以下是分层检索结果（严格推荐 + 扩展备选）：\n"
                if strict_candidates:
                    candidates_text += "【严格推荐】\n"
                    for index, candidate in enumerate(strict_candidates, 1):
                        candidates_text += _format_llm_candidate_line(candidate, index)
                if relaxed_candidates:
                    candidates_text += "【扩展备选】\n"
                    for index, candidate in enumerate(relaxed_candidates, 1):
                        candidates_text += _format_llm_candidate_line(candidate, index)
            else:
                candidates_text = "以下是多源检索到的南京真实餐厅信息（供参考）：\n"
                for index, candidate in enumerate(candidates, 1):
                    candidates_text += _format_llm_candidate_line(candidate, index)
        else:
            candidates_text = "（多源检索未找到符合条件的餐厅）"

        if search_area_label and candidates_text:
            distance_note = (
                "候选距离为“用户当前定位到店铺”的距离；"
                if gps_lng is not None
                else "候选距离为“检索锚点到店铺”的距离；"
            )
            candidates_text = (
                f"检索锚点：{search_area_label}（推荐排序按此区域筛选）。{distance_note}\n"
                + candidates_text
            )

    # 具体店名查询：与吃喝玩乐同源检索，固定模板回复，禁止落入 LLM 编造
    if is_food_request and shop_search_keywords:
        matched_shop = [c for c in candidates if _candidate_matches_shop_keywords(c, shop_search_keywords)]
        if not matched_shop:
            matched_shop = candidates[:5]
        query_name = shop_search_keywords[0]
        if matched_shop:
            lines = [_format_user_candidate_line(item, idx) for idx, item in enumerate(matched_shop[:3], 1)]
            shop_reply = (
                f"帮你查到了和「{query_name}」相关的店：\n"
                + "\n".join(lines)
                + "\n详细信息可以看下面卡片。"
            )
            _save_conversation_message(user_id, session_id, "user", user_message)
            _save_conversation_message(user_id, session_id, "assistant", shop_reply)
            db.session.commit()
            return _emit_chat_recommend_response(
                stream_mode=stream_mode,
                session_id=session_id,
                reply=shop_reply,
                candidates=_public_candidates(matched_shop[:5]),
            )
        no_shop_reply = (
            f"我用「{query_name}」及相关关键词在南大鼓楼附近检索了，暂时没匹配到明确店名。"
            "你可以试试更短的关键词（比如只搜品牌名），或告诉我大概在哪个校区/路口。"
        )
        _save_conversation_message(user_id, session_id, "user", user_message)
        _save_conversation_message(user_id, session_id, "assistant", no_shop_reply)
        db.session.commit()
        return _emit_chat_recommend_response(
            stream_mode=stream_mode,
            session_id=session_id,
            reply=no_shop_reply,
            candidates=[],
        )

    # 对明确品类需求（如饺子馆/火锅/咖啡）使用严格模板回复，
    # 避免模型在这类问题上自由发挥导致编造细节。
    strict_tokens = _resolve_name_constraints(user_message)
    if is_food_request and not candidates and strict_tokens:
        keyword_hint = strict_tokens[0] if strict_tokens else "该类型"
        fallback_reply = (
            f"我刚用多源数据按你这个条件查了，但南大附近暂时没检索到明确匹配“{keyword_hint}”的店。"
            "为了不误导你，我先不乱推荐店名。"
            "你可以换个关键词试试（比如“水饺/锅贴/馄饨”），或者放宽到“鼓楼/新街口附近”，"
            "我再给你筛一版。"
        )
        _save_conversation_message(user_id, session_id, "user", user_message)
        _save_conversation_message(user_id, session_id, "assistant", fallback_reply)
        db.session.commit()
        log_event(
            current_app.logger,
            "chat_recommend_no_candidate_strict",
            user_id=user_id,
            session_id=session_id,
            keyword_hint=keyword_hint,
        )
        return _emit_chat_recommend_response(
            stream_mode=stream_mode,
            session_id=session_id,
            reply=fallback_reply,
            candidates=[],
        )

    # 明确品类且已有候选：直接模板化输出，避免 LLM 受历史消息影响编造信息。
    if is_food_request and strict_tokens and candidates:
        top_candidates = strict_candidates[:3] if strict_candidates else candidates[:3]
        optional_candidates = relaxed_candidates[:2] if relaxed_candidates else []
        lines = []
        for idx, item in enumerate(top_candidates, 1):
            lines.append(_format_user_candidate_line(item, idx))

        reply_prefix = "按你给的类型我做了严格筛选，只保留了名称明确匹配的候选：\n"
        msg_lower = user_message.lower()
        if ("咖啡" in msg_lower or "咖啡厅" in msg_lower) and ("好吃" in msg_lower or "吃" in msg_lower):
            reply_prefix = (
                "小纠正一下：咖啡一般说“好喝”更贴切哈～\n"
                "按你想找的咖啡厅类型，我做了严格筛选，只保留了名称明确匹配的候选：\n"
            )

        strict_reply = (
            reply_prefix
            + "\n".join(lines)
        )
        if optional_candidates:
            optional_lines = []
            for idx, item in enumerate(optional_candidates, 1):
                optional_lines.append(_format_user_candidate_line(item, idx))
            strict_reply += (
                "\n另外给你两家扩展备选（匹配度略低一些）：\n"
                + "\n".join(optional_lines)
            )
        strict_reply += "\n如果你想再扩一圈，我可以继续按“鼓楼/新街口/湖南路”分区给你补充。"
        _save_conversation_message(user_id, session_id, "user", user_message)
        _save_conversation_message(user_id, session_id, "assistant", strict_reply)
        db.session.commit()
        log_event(
            current_app.logger,
            "chat_recommend_strict_template_reply",
            user_id=user_id,
            session_id=session_id,
            candidate_count=len(top_candidates),
        )
        return _emit_chat_recommend_response(
            stream_mode=stream_mode,
            session_id=session_id,
            reply=strict_reply,
            candidates=_public_candidates(candidates),
        )

    system_prompt = (
        "你是「南大图谱」校园群里的一个机器人，同学们叫你小南。\n"
        "你和大家很熟，说话像朋友一样——亲切、口语化，偶尔带点俏皮但不油腻。\n"
        "\n"
        "核心设定：\n"
        "1. 你只推荐南京市范围内的餐厅和场所。问到其他城市就老实说「我只熟南京这一片，别的地方你问问别人～」\n"
        "1.1 用户消息里若写了具体校区/片区（如仙林校区、鼓楼校区），推荐排序按该校区筛选，不要按用户当前定位去推其他区域的店；"
        "回复里提到的距离，是用户当前定位到店铺的距离（未授权定位时才是校区锚点距离）；"
        "不要把南师大/其他学校的食堂当成南大食堂推荐。"
        "店名带有「(南京大学店)」「(南大店)」的通常是校外分店，不是校内食堂，可以正常推荐。\n"
        "2. 你不是万能助手。别人聊编程、数学、政治、养生，你就说「这个我不太懂诶，不如聊聊南京哪家鸭血粉丝汤好喝？」\n"
        "3. 推荐餐厅时只能使用系统给你的检索候选。你拥有的信息仅包括：店名、地址、评分、人均价格、分类。你无法获取顾客评论、菜品图片、菜单、排队情况等。如果用户问你要评论、要具体菜品、要菜单——直接说「这个我查不到，我只有评分和人均，你可以去大众点评看看真实评价」，不要自己编造。\n"
        "3.1 向用户展示时：没有评分或人均就不要写「暂无评分」「暂无价格」，直接省略该字段；不要向用户提及数据来源。\n"
        "4. 如果用户缺少关键信息（想去哪个区？人均预算？几个人？），友好追问一两句，不要一口气问太多。\n"
        "5. 推荐1-2家即可，简单说理由。输出纯文本，不加 Markdown。\n"
        "6. 不要用「种草」「安利」「必吃」「绝绝子」这种营销口吻。推荐理由用「同学们常去」「评分不错」「性价比高」这种日常表达。\n"
        "7. 打招呼、闲聊、问天气、说「谢谢」之类，就正常聊天，不要硬扯到推荐上。\n"
        f"{preference_text}\n"
        "8. 对于候选结果中的场所，你要根据它们的「名称」和「高德分类」来判断是否真的符合用户的需求。"
        "如果用户要找某一类场所（例如咖啡厅、奶茶店、川菜馆），但某个候选场所的名称和分类明显不符合（例如叫「某某食品店」、"
        "「某某茶行」、分类是「银行」「便利店」等），你就应该把它从推荐列表中排除，"
        "并在回复中如实说明「这家xx本质上不是xx店，不推荐给你」或类似表达。宁可推荐少一些，也不要推荐不合适的店铺。\n"
        "9. 如果用户问「好吃的xx」（例如「好吃的咖啡厅」），你应该意识到「吃」这个动词用错了——咖啡厅是喝的不是吃的。"
        "用幽默的方式指出：「是不是想说好喝的咖啡厅呀？」然后再做推荐。同理，用户说「好喝的川菜馆」也要纠正为「好吃的」。\n"
        "10. 如果候选列表为空，只能明确告诉用户“当前检索不到”，并建议其换关键词或放宽范围；"
        "绝对不要输出任何具体店名、地址、评分、人均，也不要引用或编造“食客评价”。\n"
        "11. 如果候选列表不为空，只能引用候选列表里的店名；禁止新增候选外店名。\n"
        "12. 用户询问具体店名（如「李记吊笼牛肉汤如何」）时，只要候选名称包含该店名或品牌关键词，就应视为找到了，"
        "不要声称「没有这个注册门店」；店名带「(南京大学店)」的是校外分店，可正常介绍。\n"
        "\n"
        "如果用户第一次来聊天，可以主动打招呼：「嘿，我是小南！在南大附近找吃的随时问我～」"
    )

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(history)
    user_content = user_message
    if candidates_text:
        user_content = f"{user_message}\n\n{candidates_text}"
    messages.append({"role": "user", "content": user_content})

    try:
        if stream_mode:
            return _emit_chat_recommend_response(
                stream_mode=True,
                session_id=session_id,
                candidates=_public_candidates(candidates),
                llm_messages=messages,
                user_id=user_id,
                user_message=user_message,
            )
        reply = chat_with_llm(messages, temperature=0.7, max_tokens=500)
        _save_conversation_message(user_id, session_id, "user", user_message)
        _save_conversation_message(user_id, session_id, "assistant", reply)
        db.session.commit()
        log_event(
            current_app.logger,
            "conversation_turn_saved",
            user_id=user_id,
            session_id=session_id,
            history_count=len(history),
        )
        return jsonify({"session_id": session_id, "reply": reply, "candidates": _public_candidates(candidates)})
    except Exception as exc:
        db.session.rollback()
        log_event(current_app.logger, "chat_recommend_failed", level="error", user_id=user_id, error=str(exc))
        return error_response("AI 回复失败", 502, code="llm_error")


@llm_bp.route("/conversation/<session_id>/messages", methods=["GET"])
@jwt_required
@limiter.limit("60 per minute")
def get_conversation_messages(session_id):
    """获取指定会话的所有历史消息。
    
    只有当前登录用户有权访问自己的会话消息。
    """
    from app.models import ConversationMessage
    
    user_id = g.current_user_id
    
    # 验证会话属于当前用户
    messages = (
        ConversationMessage.query
        .filter_by(user_id=user_id, session_id=session_id)
        .order_by(ConversationMessage.created_at.asc())
        .all()
    )
    
    return jsonify({
        "session_id": session_id,
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in messages
        ]
    })


@llm_bp.route("/conversation/<session_id>", methods=["DELETE"])
@jwt_required
@limiter.limit("30 per minute")
def delete_conversation(session_id):
    """删除整个会话及其所有消息。"""
    from app.models import ConversationMessage
    
    user_id = g.current_user_id
    deleted_count = ConversationMessage.query.filter_by(
        user_id=user_id, session_id=session_id
    ).delete()
    db.session.commit()
    
    log_event(
        current_app.logger,
        "conversation_deleted",
        user_id=user_id,
        session_id=session_id,
        message_count=deleted_count,
    )
    return jsonify({"message": "会话已删除", "deleted_count": deleted_count})


@llm_bp.route("/conversations/batch_delete", methods=["POST"])
@jwt_required
@limiter.limit("10 per minute")
def batch_delete_conversations():
    """批量删除会话及其消息。"""
    from app.models import ConversationMessage

    user_id = g.current_user_id
    data = get_json_body(request)
    session_ids = data.get("session_ids")

    if not isinstance(session_ids, list) or not session_ids:
        return error_response("session_ids 必须是非空数组", 400, code="invalid_session_ids")

    validated_ids = []
    seen = set()
    for raw_session_id in session_ids[:200]:
        sid = validate_session_id(raw_session_id)
        if not sid or sid in seen:
            continue
        seen.add(sid)
        validated_ids.append(sid)

    if not validated_ids:
        return error_response("没有可删除的有效会话", 400, code="invalid_session_ids")

    existing_rows = (
        db.session.query(ConversationMessage.session_id)
        .filter(
            ConversationMessage.user_id == user_id,
            ConversationMessage.session_id.in_(validated_ids),
        )
        .distinct()
        .all()
    )
    existing_session_ids = [row[0] for row in existing_rows]

    if not existing_session_ids:
        return jsonify({
            "message": "没有匹配到可删除会话",
            "deleted_sessions": 0,
            "deleted_messages": 0,
        })

    deleted_messages = (
        ConversationMessage.query
        .filter(
            ConversationMessage.user_id == user_id,
            ConversationMessage.session_id.in_(existing_session_ids),
        )
        .delete(synchronize_session=False)
    )
    db.session.commit()

    log_event(
        current_app.logger,
        "conversations_batch_deleted",
        user_id=user_id,
        deleted_sessions=len(existing_session_ids),
        deleted_messages=deleted_messages,
    )
    return jsonify({
        "message": "批量删除成功",
        "deleted_sessions": len(existing_session_ids),
        "deleted_messages": deleted_messages,
    })
