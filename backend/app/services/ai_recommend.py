"""
AI 小南推荐：候选检索与吃喝玩乐 guide 页完全同源。

规则：
- 调用 guide.search_ai_guide_places / fetch_ai_guide_seed / search_guide_places_near
- 支持 GUIDE_CATEGORY_CONFIG 全部分类
- 商场分支：识别商场 POI 后以小半径 around 检索
- keyword 仅来自品类白名单或明确品牌
"""

import re
import time as _time
from math import asin, cos, radians, sin, sqrt

from app import db
from app.models import User
from app.services.amap import inputtips, search_places
from app.services.guide import (
    GUIDE_CAMPUS_COORDS,
    dedupe_guide_items,
    effective_rating,
    enrich_guide_items,
    fetch_ai_guide_seed,
    fetch_db_leaderboard_candidates,
    merge_leaderboard_candidates,
    search_ai_guide_places,
    search_guide_places_near,
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

_MALL_AROUND_RADIUS_M = 600

# 南京常见商场/购物中心（长名优先匹配）
_MALL_NAME_ALIASES = [
    ("艾尚天地", "艾尚天地"),
    ("金鹰国际", "金鹰"),
    ("金鹰世界", "金鹰世界"),
    ("虹悦城", "虹悦城"),
    ("万象天地", "万象天地"),
    ("河西万达", "万达"),
    ("万达广场", "万达"),
    ("德基广场", "德基"),
    ("德基", "德基"),
    ("新街口德基", "德基"),
    ("大洋百货", "大洋"),
    ("水游城", "水游城"),
    ("金茂汇", "金茂汇"),
    ("仙林金鹰", "金鹰"),
    ("东城汇", "东城汇"),
    ("九霄梦天地", "九霄"),
    ("砂之船", "砂之船"),
    ("江北虹悦城", "虹悦城"),
    ("华采天地", "华采"),
    ("龙湖天街", "天街"),
]

_SCENIC_MARKERS = (
    "景点", "公园", "博物馆", "纪念馆", "动物园", "爬山", "徒步", "玄武湖",
    "打卡", "赏花", "樱花", "湿地", "广场", "古迹", "寺", "湖", "山",
)
_FUN_MARKERS = (
    "电影", "影院", "KTV", "桌游", "密室", "剧本杀", "酒吧", "休闲",
    "好玩", "玩什么", "娱乐", "游乐", "放松", "逛展",
)
_SPORT_MARKERS = (
    "健身", "游泳", "羽毛球", "篮球", "球场", "体育馆", "瑜伽", "滑雪",
    "运动", "撸铁", "跑步",
)
_SHOP_MARKERS = (
    "逛街", "购物", "超市", "商场", "商城", "百货", "买", "购物中心",
)

_FOOD_INTENT = (
    "吃", "饭", "餐", "美食", "好吃", "饿了", "夜宵", "早餐", "午餐", "晚餐",
    "川菜", "湘菜", "火锅", "烧烤", "咖啡", "奶茶", "外卖", "食堂",
    "什么店", "小吃", "甜点", "面包", "饺子", "面馆", "饭馆", "菜馆",
    "好喝", "聚餐", "约会", "请客", "平价", "便宜", "餐厅", "人均",
)

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
_BROAD_FUN_QUERY = re.compile(
    r"有什么玩|有啥玩|玩什么|玩啥|去哪玩|哪里玩|附近.*玩|有什么.*玩"
)

_CLARIFICATION_REPLY_MARKERS = ("想吃", "哪一类", "什么类型", "啥口味", "先告诉我", "想玩")

_CLARIFICATION_CHIPS = {
    "美食": ["火锅", "面馆", "烧烤", "川菜", "咖啡奶茶"],
    "咖啡饮品": ["咖啡", "奶茶", "甜品", "面包"],
    "休闲娱乐": ["电影", "KTV", "桌游", "酒吧"],
    "运动健身": ["健身", "羽毛球", "游泳", "篮球"],
    "购物商圈": ["商场", "超市", "逛街"],
    "景点公园": ["公园", "博物馆", "打卡"],
}

_CATEGORY_SHOWS_COST = frozenset({"美食", "咖啡饮品"})

_SEARCH_CACHE = {}
_SEARCH_CACHE_TTL = 45


def is_food_intent(message: str) -> bool:
    """兼容旧测试：美食/咖啡饮品意图。"""
    cat = classify_guide_intent(message)
    return cat in ("美食", "咖啡饮品")


def classify_guide_intent(message: str):
    """识别 guide 分类；无法识别返回 None（纯闲聊）。"""
    text = (message or "").strip()
    if not text:
        return None

    if any(m in text for m in _DRINK_CATEGORY_MARKERS):
        return "咖啡饮品"
    if any(m in text for m in _SCENIC_MARKERS):
        return "景点公园"
    if any(m in text for m in _FUN_MARKERS):
        return "休闲娱乐"
    if any(m in text for m in _SPORT_MARKERS):
        return "运动健身"
    if any(m in text for m in _SHOP_MARKERS):
        return "购物商圈"
    if any(token in text for token in _FOOD_INTENT):
        return "咖啡饮品" if any(m in text for m in _DRINK_CATEGORY_MARKERS) else "美食"
    for marker, _ in _CUISINE_KEYWORDS:
        if marker in text:
            return "美食"
    return None


def detect_mall_keyword(message: str):
    """从消息中提取商场检索词，未命中返回 None。"""
    text = (message or "").strip()
    if not text:
        return None
    for alias, keyword in sorted(_MALL_NAME_ALIASES, key=lambda x: len(x[0]), reverse=True):
        if alias in text:
            return keyword
    return None


def resolve_mall_anchor(message: str, city="南京"):
    """解析商场 POI 坐标；失败返回 None。"""
    keyword = detect_mall_keyword(message)
    if not keyword:
        return None

    try:
        tips_data = inputtips(keyword, city=city)
        for tip in tips_data.get("tips") or []:
            loc = str(tip.get("location") or "").strip()
            name = (tip.get("name") or "").strip()
            if loc and "," in loc and name:
                return {"name": name, "location": loc, "keyword": keyword}
    except Exception:
        pass

    try:
        result = search_places(keyword, city=city, types="060100", page_size=8)
        if str(result.get("status")) == "1":
            for poi in result.get("pois") or []:
                loc = str(poi.get("location") or "").strip()
                name = (poi.get("name") or "").strip()
                if loc and "," in loc and name:
                    return {"name": name, "location": loc, "keyword": keyword}
    except Exception:
        pass

    return None


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
    return needs_guide_clarification(message, "美食", history=history)


def needs_guide_clarification(message: str, category: str, history=None) -> bool:
    """宽泛问法先追问，不立刻推具体 POI。"""
    text = (message or "").strip()
    if not category:
        return False

    if history and _was_awaiting_clarification(history):
        if len(text) <= 8 or _has_cuisine_or_brand(text):
            return False
        if category != "美食" and any(m in text for m in _SCENIC_MARKERS + _FUN_MARKERS + _SPORT_MARKERS):
            return False

    if category in ("美食", "咖啡饮品"):
        if not is_food_intent(text):
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
        if re.search(r"有什么|有啥|哪些", text) and "吃" in text:
            return True
        return False

    if category == "休闲娱乐" and _BROAD_FUN_QUERY.search(text):
        return True
    if category == "购物商圈" and re.search(r"有什么|有啥|哪些|推荐", text) and not detect_mall_keyword(text):
        return True

    return False


def clarification_chips_for(category: str):
    return list(_CLARIFICATION_CHIPS.get(category or "美食", []))


def _default_campus(user_id=None) -> str:
    if not user_id:
        return "鼓楼"
    campus = db.session.query(User.campus).filter_by(id=user_id).scalar()
    campus = (campus or "").strip()
    return campus if campus in GUIDE_CAMPUS_COORDS else "鼓楼"


def resolve_campus(message: str, user_id=None, default="鼓楼") -> str:
    text = (message or "").strip()
    for alias, campus in sorted(_CAMPUS_IN_MESSAGE, key=lambda x: len(x[0]), reverse=True):
        if alias in text and campus in GUIDE_CAMPUS_COORDS:
            return campus
    if user_id is not None:
        return _default_campus(user_id)
    return default if default in GUIDE_CAMPUS_COORDS else "鼓楼"


def resolve_category(message: str) -> str:
    return classify_guide_intent(message) or "美食"


def resolve_guide_keyword(message: str, category: str = "美食") -> str:
    text = (message or "").strip()
    if not text:
        return ""

    if category in ("美食", "咖啡饮品"):
        for marker, kw in sorted(_CUISINE_KEYWORDS, key=lambda x: len(x[0]), reverse=True):
            if marker in text:
                return kw
        if _GENERIC_QUERY.search(text):
            return ""
        brand = _BRAND_RE.search(text)
        if brand:
            return brand.group(0)

    if category == "休闲娱乐" and "电影" in text:
        return "电影"
    if category == "景点公园":
        for kw in ("博物馆", "公园", "玄武湖", "夫子庙"):
            if kw in text:
                return kw

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


def _rank_items(message, items, category="美食"):
    text = (message or "").lower()
    prefer_cheap = category in _CATEGORY_SHOWS_COST and any(h in text for h in _BUDGET_HINT)
    prefer_rating = any(h in text for h in _RATING_HINT)
    prefer_nearby = any(h in text for h in _NEARBY_HINT)

    dist_weight = 0.55 if prefer_nearby else 0.35
    rating_weight = 0.35 if prefer_rating else 0.28
    dist_scale = 5000.0 if prefer_nearby else 8000.0
    price_weight = 0.25 if prefer_cheap else 0.0

    def score(item):
        rating = effective_rating(item)
        dist = item.get("distance_m")
        dist_s = max(0.0, 1.0 - (dist or 9999) / dist_scale) if dist is not None else 0.0
        likes = min(int(item.get("like_count") or 0), 20) / 20.0
        base = rating * rating_weight + dist_s * dist_weight + likes * 0.12
        price = _parse_price(item.get("price"))
        if price_weight and price is not None:
            base += max(0.0, 1.0 - min(price, 200) / 200.0) * price_weight
        if prefer_rating:
            base += rating * 0.2
        return base

    return sorted(items, key=score, reverse=True)


def _guide_items_to_candidates(items, gps_lng, gps_lat, category="美食", campus="鼓楼"):
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
            "type": item.get("type") or category,
            "guide_category": category,
            "campus": campus,
            "place_id": item.get("place_id"),
            "poi_id": item.get("poi_id") or "",
            "rating": rating,
            "cost": cost if category in _CATEGORY_SHOWS_COST else "",
            "distance_text": _distance_text(item, gps_lng, gps_lat),
            "rating_num": rating_num,
        })
    return out


def _candidates_for_api(candidates):
    api = []
    for c in candidates or []:
        row = {
            "name": c.get("name") or "",
            "address": c.get("address") or "",
            "location": c.get("location") or "",
            "type": c.get("type") or "",
            "guide_category": c.get("guide_category") or "",
            "campus": c.get("campus") or "",
            "place_id": c.get("place_id"),
            "poi_id": c.get("poi_id") or "",
            "rating": c.get("rating") or "",
            "cost": c.get("cost") or "",
            "distance_text": c.get("distance_text") or "",
        }
        if row["rating"] in ("暂无评分", "无评分"):
            row["rating"] = ""
        api.append(row)
    return api


def _llm_context_text(candidates, campus, category, hints=(), mode="campus", mall_name=None):
    if not candidates:
        scope = f"{mall_name}周边" if mode == "mall_anchor" and mall_name else f"{campus}校区"
        return (
            f"（{scope}「{category}」下未检索到 POI；"
            "候选来自吃喝玩乐同源高德 POI，请勿编造名称。）"
        )
    scope = f"{mall_name}周边" if mode == "mall_anchor" and mall_name else f"{campus}校区"
    lines = [
        f"候选列表（{scope} · guide分类「{category}」· 高德固定 types）：\n"
    ]
    if mode == "mall_anchor" and mall_name:
        lines.append(
            f"【提示】以下候选以「{mall_name}」为中心周边检索，"
            "无法保证均在商场室内或具体楼层。\n"
        )
    for h in hints:
        lines.append(h + "\n")
    show_cost = category in _CATEGORY_SHOWS_COST
    for i, c in enumerate(candidates, 1):
        parts = [c["name"]]
        if c.get("address"):
            parts.append(c["address"])
        if c.get("distance_text"):
            parts.append(f"距离约{c['distance_text']}")
        if c.get("rating"):
            parts.append(f"评分{c['rating']}")
        if show_cost and c.get("cost"):
            parts.append(f"人均{c['cost']}")
        lines.append(f"{i}. " + "，".join(parts))
    return "\n".join(lines)


def _clarification_context_text(message, campus, category):
    location_hint = ""
    text = (message or "").strip()
    if any(h in text for h in _NEARBY_HINT):
        location_hint = "用户强调了「附近」，后续推荐时距离要优先。"
    chips = "、".join(clarification_chips_for(category)[:6])
    if category in ("美食", "咖啡饮品"):
        solo_hint = ""
        if any(h in text for h in _SOLO_DINING_HINT):
            solo_hint = "用户是一个人吃饭，可顺带问口味偏好，但本轮仍不要推具体店名。"
        return (
            f"【系统指令】用户问题「{text}」较宽泛，未指定菜系或品类。"
            f"本轮不要推荐任何具体店铺，不要复述用户原句当检索词。"
            f"请友好地问用户更想吃哪一类（{chips} 等），"
            f"说明缩小范围后才能给出更合适的推荐。可提及大致位置（{campus}校区一带）。"
            f"{solo_hint}{location_hint}"
        )
    return (
        f"【系统指令】用户问题「{text}」较宽泛。"
        f"本轮不要推荐具体 POI，请追问想做什么（{chips} 等）。"
        f"可提及 {campus} 校区一带。{location_hint}"
    )


_FORBIDDEN_REPLY_RE = re.compile(
    r"帮你查到了|相关的店|我用[「\"']|关键词检索|详细信息可以看下面卡片|"
    r"严格筛选|暂时没匹配到明确店名"
)


def sanitize_llm_reply(reply: str, candidates_api=None, needs_clarification=False) -> str:
    text = (reply or "").strip()
    if not text or not _FORBIDDEN_REPLY_RE.search(text):
        return text

    if needs_clarification:
        return (
            "得先知道你更想干啥～可以说具体一点，比如火锅、电影、公园打卡，"
            "我再帮你挑几家合适的。"
        )

    names = [c.get("name") for c in (candidates_api or [])[:2] if c.get("name")]
    if names:
        return f"这几家你看看：{'、'.join(names)}。更多在下面卡片里～"
    return "你说一下更想吃什么或玩什么，我好帮你挑～"


def _cache_get(key):
    entry = _SEARCH_CACHE.get(key)
    if not entry:
        return None
    ts, val = entry
    if _time.time() - ts > _SEARCH_CACHE_TTL:
        _SEARCH_CACHE.pop(key, None)
        return None
    return val


def _cache_set(key, val):
    _SEARCH_CACHE[key] = (_time.time(), val)


def _fetch_guide_items(
    *,
    mode,
    campus,
    category,
    keyword,
    user_id,
    mall_location=None,
):
    cache_key = (mode, campus, category, keyword, user_id, mall_location)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    def _pull_campus(kw):
        payload = search_ai_guide_places(campus, category, keyword=kw, user_id=user_id)
        if payload.get("error"):
            return []
        return payload.get("items") or []

    def _pull_mall(kw):
        payload = search_guide_places_near(
            mall_location,
            category,
            keyword=kw,
            campus=campus,
            user_id=user_id,
            radius=_MALL_AROUND_RADIUS_M,
        )
        if payload.get("error"):
            return []
        return payload.get("items") or []

    pull = _pull_mall if mode == "mall_anchor" and mall_location else _pull_campus

    amap_items = []
    if keyword:
        amap_items.extend(pull(keyword))
    if not amap_items:
        amap_items.extend(pull(""))

    seed_items = []
    if mode != "mall_anchor" and len(amap_items) < 5:
        seed_items = fetch_ai_guide_seed(campus, category)

    remote_items = dedupe_guide_items(amap_items + seed_items)
    db_items = []
    if mode != "mall_anchor":
        db_items = fetch_db_leaderboard_candidates(campus, category)

    if remote_items:
        remote_items = enrich_guide_items(
            remote_items,
            user_id=user_id,
            campus=campus,
            category=category,
        )
    if db_items:
        db_items = enrich_guide_items(
            db_items,
            user_id=user_id,
            campus=campus,
            category=category,
        )

    items = merge_leaderboard_candidates(remote_items, db_items)

    if items:
        _cache_set(cache_key, items)
    return items


def _empty_context(message, user_id=None):
    campus = resolve_campus(message, user_id=user_id)
    return {
        "is_guide_request": False,
        "is_food_request": False,
        "needs_clarification": False,
        "candidates": [],
        "candidates_api": [],
        "candidates_text": "",
        "clarification_text": "",
        "clarification_chips": [],
        "campus": campus,
        "category": None,
        "mode": "chat",
        "mall_name": None,
    }


def prepare_chat_recommend_context(message, user_id=None, gps_location=None, history=None):
    """
    为 chat_recommend 准备候选与 LLM 上下文。
    检索链：商场锚点 around 或 search_ai_guide_places → 不足则 fetch_ai_guide_seed。
    """
    category = classify_guide_intent(message)
    if not category:
        return _empty_context(message, user_id=user_id)

    campus = resolve_campus(message, user_id=user_id)
    mall_anchor = resolve_mall_anchor(message)
    mode = "mall_anchor" if mall_anchor else "campus"
    mall_name = mall_anchor.get("name") if mall_anchor else None
    mall_location = mall_anchor.get("location") if mall_anchor else None

    # 商场场景且未明确其他分类时，默认按餐饮检索
    if mode == "mall_anchor" and category == "购物商圈":
        if any(t in message for t in ("吃", "餐", "喝", "美食", "饭店")):
            category = "美食"
        elif any(t in message for t in _FUN_MARKERS):
            category = "休闲娱乐"
        else:
            category = "美食"

    if needs_guide_clarification(message, category, history=history):
        chips = clarification_chips_for(category)
        return {
            "is_guide_request": True,
            "is_food_request": category in ("美食", "咖啡饮品"),
            "needs_clarification": True,
            "candidates": [],
            "candidates_api": [],
            "candidates_text": "",
            "clarification_text": _clarification_context_text(message, campus, category),
            "clarification_chips": chips,
            "campus": campus,
            "category": category,
            "mode": mode,
            "mall_name": mall_name,
        }

    keyword = resolve_guide_keyword(message, category)
    gps_lng, gps_lat = _parse_loc(gps_location) if gps_location else (None, None)

    if mode == "mall_anchor" and not mall_location:
        mode = "campus"
        mall_name = None

    items = _fetch_guide_items(
        mode=mode,
        campus=campus,
        category=category,
        keyword=keyword,
        user_id=user_id,
        mall_location=mall_location,
    )

    ranked = _rank_items(message, items, category=category)
    candidates = _guide_items_to_candidates(
        ranked[:8], gps_lng, gps_lat, category=category, campus=campus,
    )[:5]

    hints = []
    if any(h in message for h in _AMBIANCE_HINT):
        hints.append(
            "【提示】用户问氛围（安静等），数据无此标签；说明只能按距离/评分推荐。"
        )
    if category in _CATEGORY_SHOWS_COST and any(h in message for h in _BUDGET_HINT):
        hints.append("【提示】用户在意价格，优先推荐人均较低的候选。")
    if any(h in message for h in _RATING_HINT):
        hints.append("【提示】用户在意评分，优先推荐评分高的候选。")

    return {
        "is_guide_request": True,
        "is_food_request": category in ("美食", "咖啡饮品"),
        "needs_clarification": False,
        "candidates": candidates,
        "candidates_api": _candidates_for_api(candidates),
        "candidates_text": _llm_context_text(
            candidates, campus, category, hints, mode=mode, mall_name=mall_name,
        ),
        "clarification_text": "",
        "clarification_chips": [],
        "campus": campus,
        "category": category,
        "mode": mode,
        "mall_name": mall_name,
    }
