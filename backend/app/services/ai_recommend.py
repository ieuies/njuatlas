"""
AI 小南餐饮推荐：候选检索与吃喝玩乐 guide 页完全同源。

规则：
- 仅调用 guide.search_ai_dining_places / fetch_ai_dining_seed
- 仅允许固定分类「美食」「咖啡饮品」（高德 types 见 GUIDE_CATEGORY_CONFIG）
- 禁止从用户句子里抠噪声词当店名；keyword 仅来自品类白名单或明确品牌
"""

import re
from math import asin, cos, radians, sin, sqrt

from app.services.guide import (
    AI_DINING_CATEGORIES,
    GUIDE_CAMPUS_COORDS,
    dedupe_guide_items,
    effective_rating,
    enrich_guide_items,
    fetch_ai_dining_seed,
    search_ai_dining_places,
)

_CAMPUS_IN_MESSAGE = [
    ("仙林校区", "仙林"),
    ("鼓楼校区", "鼓楼"),
    ("浦口校区", "浦口"),
    ("仙林大学城", "仙林"),
    ("汉口路", "鼓楼"),
    ("珠江路", "鼓楼"),
    ("新街口", "鼓楼"),
    ("夫子庙", "鼓楼"),
    ("南大南门", "鼓楼"),
    ("南门", "鼓楼"),
    ("仙林", "仙林"),
    ("鼓楼", "鼓楼"),
    ("浦口", "浦口"),
    ("苏州", "苏州"),
]

# 命中任一即视为在问吃的（触发 guide 检索）
_FOOD_INTENT = (
    "吃", "饭", "餐", "美食", "推荐", "好吃", "饿了", "夜宵", "早餐", "午餐", "晚餐",
    "川菜", "湘菜", "火锅", "烧烤", "咖啡", "奶茶", "外卖", "食堂", "哪家", "哪里",
    "什么店", "有啥", "有没有", "小吃", "甜点", "面包", "饺子", "面馆", "饭馆",
    "菜馆", "好喝", "附近", "周边", "聚餐", "约会", "请客", "平价", "便宜", "餐厅",
    "评分", "人均", "好喝",
)

# 可作为 search_guide_places keyword 的品类词（白名单）
_CUISINE_KEYWORDS = [
    ("江浙菜", "江浙菜"),
    ("饺子馆", "饺子"),
    ("水饺", "饺子"),
    ("面馆", "面"),
    ("烧烤", "烧烤"),
    ("火锅", "火锅"),
    ("川菜", "川菜"),
    ("湘菜", "湘菜"),
    ("粤菜", "粤菜"),
    ("日料", "日料"),
    ("韩餐", "韩餐"),
    ("西餐", "西餐"),
    ("麻辣烫", "麻辣烫"),
    ("馄饨", "馄饨"),
    ("甜品", "甜品"),
    ("面包", "面包"),
    ("蛋糕", "蛋糕"),
    ("饺子", "饺子"),
    ("小吃", "小吃"),
    ("拉面", "拉面"),
]

_DRINK_CATEGORY_MARKERS = ("咖啡", "奶茶", "茶饮", "饮品", "咖啡厅", "咖啡馆")

# 泛问法：不得把整句或碎片当 keyword
_GENERIC_QUERY = re.compile(
    r"有没有|有什么|哪些|推荐一家|推荐个|推荐几家|推荐一下|有推荐|推荐吗|"
    r"便宜的|便宜又|好吃的|想吃|想去|一个人|独自|自己吃|"
    r"安静|环境好|适合自习|评分高|评分高的|高分|口碑好|哪家|哪里"
)

_SOLO_DINING_HINT = ("一个人吃", "一个人吃饭", "独自吃", "自己吃", "单人")
_GENERAL_RECOMMEND = re.compile(r"有推荐吗|推荐吗|推荐一下|能给推荐|有什么推荐|给推荐")

_BRAND_RE = re.compile(
    r"(李|张|王|刘|陈|赵|周|吴|黄|杨)[记氏馆]|"
    r"麦当劳|肯德基|星巴克|必胜客|海底捞|萨莉亚"
)

_AMBIANCE_HINT = ("安静", "环境好", "适合自习", "有包厢", "上菜快")
_BUDGET_HINT = ("便宜", "平价", "性价比", "实惠", "划算", "便宜又好吃")
_RATING_HINT = ("评分高", "评分高的", "高分", "口碑好")
_NEARBY_HINT = ("附近", "周边", "邻近", "周围")

_BROAD_FOOD_QUERY = re.compile(
    r"有什么吃|有啥吃|吃什么|吃啥|什么好吃|有啥好吃|有什么好吃|"
    r"哪儿吃|哪里吃|哪家吃|附近.*吃|周边.*吃|周围.*吃|"
    r"有什么.*吃|有啥.*吃|吃.*什么|吃.*啥"
)

_CLARIFICATION_REPLY_MARKERS = ("想吃", "哪一类", "什么类型", "啥口味", "先告诉我")


def is_food_intent(message: str) -> bool:
    text = (message or "").strip().lower()
    if not text:
        return False
    if any(token in text for token in _FOOD_INTENT):
        return True
    for marker, _ in _CUISINE_KEYWORDS:
        if marker in text:
            return True
    if any(m in text for m in _DRINK_CATEGORY_MARKERS):
        return True
    return False


def _has_cuisine_or_brand(message: str) -> bool:
    text = (message or "").strip()
    for marker, _ in _CUISINE_KEYWORDS:
        if marker in text:
            return True
    if _BRAND_RE.search(text):
        return True
    if any(m in text for m in _DRINK_CATEGORY_MARKERS):
        return True
    return False


def _was_awaiting_clarification(history) -> bool:
    if not history:
        return False
    for msg in reversed(history):
        if msg.get("role") != "assistant":
            continue
        content = msg.get("content") or ""
        return any(m in content for m in _CLARIFICATION_REPLY_MARKERS)
    return False


def needs_food_clarification(message: str, history=None) -> bool:
    """
    宽泛问法（附近有什么吃的）先追问品类，不立刻推店。
    若用户已说明菜系/饮品，或在意氛围/价格/评分，则直接检索推荐。
    """
    text = (message or "").strip()
    if not is_food_intent(text):
        return False

    if history and _was_awaiting_clarification(history):
        if _has_cuisine_or_brand(text) or len(text) <= 8:
            return False

    if _has_cuisine_or_brand(text):
        return False

    if any(h in text for h in _AMBIANCE_HINT + _BUDGET_HINT + _RATING_HINT):
        return False

    if any(h in text for h in _SOLO_DINING_HINT):
        return True

    if _GENERAL_RECOMMEND.search(text):
        return True

    if _BROAD_FOOD_QUERY.search(text):
        return True

    if re.search(r"有什么|有啥|哪些", text):
        return True

    return False


def resolve_campus(message: str, default="鼓楼") -> str:
    text = (message or "").strip()
    for alias, campus in sorted(_CAMPUS_IN_MESSAGE, key=lambda x: len(x[0]), reverse=True):
        if alias in text and campus in GUIDE_CAMPUS_COORDS:
            return campus
    return default if default in GUIDE_CAMPUS_COORDS else "鼓楼"


def resolve_category(message: str) -> str:
    text = (message or "").strip()
    if any(m in text for m in _DRINK_CATEGORY_MARKERS):
        return "咖啡饮品"
    return "美食"


def resolve_guide_keyword(message: str) -> str:
    """
    传给 search_guide_places 的 keyword。
    仅允许品类白名单或明确品牌；禁止把用户原句或碎片当 keyword。
    """
    text = (message or "").strip()
    if not text:
        return ""

    for marker, kw in sorted(_CUISINE_KEYWORDS, key=lambda x: len(x[0]), reverse=True):
        if marker in text:
            return kw

    if _GENERIC_QUERY.search(text):
        return ""

    brand = _BRAND_RE.search(text)
    if brand:
        return brand.group(0)

    return ""


def _parse_loc(loc):
    if not loc or "," not in str(loc):
        return None, None
    try:
        a, b = str(loc).split(",", 1)
        return float(a), float(b)
    except (TypeError, ValueError):
        return None, None


def _haversine_m(lng1, lat1, lng2, lat2):
    lng1, lat1, lng2, lat2 = map(radians, [lng1, lat1, lng2, lat2])
    dlng = lng2 - lng1
    dlat = lat2 - lat1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlng / 2) ** 2
    return int(2 * 6371000 * asin(sqrt(a)))


def _distance_text(item, gps_lng, gps_lat):
    dist_m = item.get("distance_m")
    if gps_lng is not None:
        plng, plat = _parse_loc(item.get("location"))
        if plng is not None:
            dist_m = _haversine_m(gps_lng, gps_lat, plng, plat)
    if dist_m is None:
        return ""
    d = int(dist_m)
    return f"{d}m" if d < 1000 else f"{d / 1000:.1f}km"


def _parse_price(price_str):
    if not price_str:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)", str(price_str).replace("¥", ""))
    if not m:
        return None
    try:
        return float(m.group(1))
    except ValueError:
        return None


def _rank_items(message, items):
    text = (message or "").lower()
    prefer_cheap = any(h in text for h in _BUDGET_HINT)
    prefer_rating = any(h in text for h in _RATING_HINT)
    prefer_nearby = any(h in text for h in _NEARBY_HINT)

    dist_weight = 0.55 if prefer_nearby else 0.3
    rating_weight = 0.22 if prefer_nearby else 0.35
    dist_scale = 5000.0 if prefer_nearby else 8000.0

    def score(item):
        rating = effective_rating(item)
        dist = item.get("distance_m")
        dist_s = max(0.0, 1.0 - (dist or 9999) / dist_scale) if dist is not None else 0.0
        likes = min(int(item.get("like_count") or 0), 20) / 20.0
        base = rating * rating_weight + dist_s * dist_weight + likes * 0.15
        price = _parse_price(item.get("price"))
        if prefer_cheap and price is not None:
            base += max(0.0, 1.0 - min(price, 200) / 200.0) * 0.25
        if prefer_rating:
            base += rating * 0.25
        else:
            base += rating * 0.1
        return base

    return sorted(items, key=score, reverse=True)


def _guide_items_to_candidates(items, gps_lng, gps_lat):
    out = []
    for item in items:
        rating = str(item.get("rating") or "").strip()
        cost = str(item.get("price") or "").replace("¥", "").replace("/人", "").strip()
        rating_num = None
        if rating:
            try:
                rating_num = float(rating)
            except ValueError:
                pass
        out.append({
            "name": item.get("name") or "",
            "address": item.get("address") or item.get("desc") or "",
            "location": item.get("location") or "",
            "type": item.get("type") or "美食",
            "rating": rating,
            "cost": cost,
            "distance_text": _distance_text(item, gps_lng, gps_lat),
            "rating_num": rating_num,
        })
    return out


def _candidates_for_api(candidates):
    """前端卡片字段（隐藏内部字段）。"""
    api = []
    for c in candidates or []:
        row = {
            "name": c.get("name") or "",
            "address": c.get("address") or "",
            "location": c.get("location") or "",
            "type": c.get("type") or "",
            "rating": c.get("rating") or "",
            "cost": c.get("cost") or "",
            "distance_text": c.get("distance_text") or "",
        }
        if row["rating"] in ("暂无评分", "无评分"):
            row["rating"] = ""
        if row["cost"] in ("暂无价格", ""):
            pass
        api.append(row)
    return api


def _llm_context_text(candidates, campus, category, hints=()):
    if not candidates:
        return (
            f"（{campus}校区「{category}」下未检索到餐饮店；"
            "候选来自吃喝玩乐同源高德 POI，请勿编造店名。）"
        )
    lines = [
        f"候选列表（{campus}校区 · guide分类「{category}」· 仅限高德固定餐饮 types）：\n"
    ]
    for h in hints:
        lines.append(h + "\n")
    for i, c in enumerate(candidates, 1):
        parts = [c["name"]]
        if c.get("address"):
            parts.append(c["address"])
        if c.get("distance_text"):
            parts.append(f"距离约{c['distance_text']}")
        if c.get("rating"):
            parts.append(f"评分{c['rating']}")
        if c.get("cost"):
            parts.append(f"人均{c['cost']}")
        lines.append(f"{i}. " + "，".join(parts))
    return "\n".join(lines)


def _clarification_context_text(message, campus):
    location_hint = ""
    text = (message or "").strip()
    if any(h in text for h in _NEARBY_HINT):
        location_hint = "用户强调了「附近」，后续推荐时距离要优先。"
    solo_hint = ""
    if any(h in text for h in _SOLO_DINING_HINT):
        solo_hint = "用户是一个人吃饭，可顺带问口味偏好，但本轮仍不要推具体店名。"
    return (
        f"【系统指令】用户问题「{text}」较宽泛，未指定菜系或品类。"
        f"本轮不要推荐任何具体店铺，不要复述或引用用户原句当检索词，不要输出候选卡片内容。"
        f"请友好地问用户更想吃哪一类（面馆、火锅、烧烤、川菜、咖啡奶茶、小吃等），"
        f"说明缩小范围后才能给出更合适的推荐。可提及大致位置（{campus}校区一带）。"
        f"{solo_hint}{location_hint}"
    )


_FORBIDDEN_REPLY_RE = re.compile(
    r"帮你查到了|相关的店|我用[「\"']|关键词检索|详细信息可以看下面卡片|"
    r"严格筛选|暂时没匹配到明确店名"
)


def sanitize_llm_reply(reply: str, candidates_api=None, needs_clarification=False) -> str:
    """兜底：若模型仍输出旧套话或复述用户碎片，替换为自然口语。"""
    text = (reply or "").strip()
    if not text or not _FORBIDDEN_REPLY_RE.search(text):
        return text

    if needs_clarification:
        return (
            "一个人吃饭也得看想吃啥呀～面馆、简餐、火锅还是咖啡轻食？"
            "你说个方向，我再帮你挑几家合适的。"
        )

    names = [c.get("name") for c in (candidates_api or [])[:2] if c.get("name")]
    if names:
        return f"这几家你看看：{'、'.join(names)}。更多在下面卡片里～"
    return "你更想吃哪一类？说一下我好帮你挑～"


def prepare_chat_recommend_context(message, user_id=None, gps_location=None, history=None):
    """
    为 chat_recommend 准备候选与 LLM 上下文。
    检索链：search_ai_dining_places → 不足则 fetch_ai_dining_seed。
    """
    if not is_food_intent(message):
        return {
            "is_food_request": False,
            "needs_clarification": False,
            "candidates": [],
            "candidates_api": [],
            "candidates_text": "",
            "clarification_text": "",
            "campus": resolve_campus(message),
            "category": resolve_category(message),
        }

    campus = resolve_campus(message)
    category = resolve_category(message)

    if needs_food_clarification(message, history=history):
        return {
            "is_food_request": True,
            "needs_clarification": True,
            "candidates": [],
            "candidates_api": [],
            "candidates_text": "",
            "clarification_text": _clarification_context_text(message, campus),
            "campus": campus,
            "category": category,
        }

    keyword = resolve_guide_keyword(message)
    gps_lng, gps_lat = _parse_loc(gps_location) if gps_location else (None, None)

    items = []

    def _pull(kw):
        payload = search_ai_dining_places(campus, category, keyword=kw, user_id=user_id)
        if payload.get("error"):
            return []
        return payload.get("items") or []

    seen = set()
    def _add(batch):
        for it in batch:
            key = it.get("poi_id") or it.get("name")
            if not key or key in seen:
                continue
            seen.add(key)
            items.append(it)

    if keyword:
        _add(_pull(keyword))
    if not items:
        _add(_pull(""))

    if len(items) < 5:
        seed = enrich_guide_items(
            dedupe_guide_items(fetch_ai_dining_seed(campus, category)),
            user_id=user_id,
            campus=campus,
            category=category,
        )
        _add(seed)

    ranked = _rank_items(message, items)
    candidates = _guide_items_to_candidates(ranked[:8], gps_lng, gps_lat)[:5]

    hints = []
    if any(h in message for h in _AMBIANCE_HINT):
        hints.append(
            "【提示】用户问氛围（安静等），数据无此标签；说明只能按距离/评分推荐，建议看大众点评。"
        )
    if any(h in message for h in _BUDGET_HINT):
        hints.append("【提示】用户在意价格，优先推荐人均较低的候选。")
    if any(h in message for h in _RATING_HINT):
        hints.append("【提示】用户在意评分，优先推荐评分高的候选。")

    return {
        "is_food_request": True,
        "needs_clarification": False,
        "candidates": candidates,
        "candidates_api": _candidates_for_api(candidates),
        "candidates_text": _llm_context_text(candidates, campus, category, hints),
        "clarification_text": "",
        "campus": campus,
        "category": category,
    }
