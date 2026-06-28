"""
AI 小鲸灵推荐：候选检索与吃喝玩乐 guide 页完全同源。

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
    guide_search_city,
    merge_leaderboard_candidates,
    search_ai_guide_places,
    search_guide_places_near,
)

# 高德 POI：购物中心
_AMAP_MALL_TYPE_CODE = "060100"

# 高德限流/失败时的常见南京商场锚点（keyword 子串匹配）
_KNOWN_MALL_ANCHORS = (
    (("德基", "德基广场"), {
        "name": "德基广场",
        "location": "118.783168,32.041544",
        "poi_id": "fallback-deji",
        "type": "060100",
    }),
    (("金鹰", "金鹰国际"), {
        "name": "金鹰国际购物中心(新街口店)",
        "location": "118.783892,32.041012",
        "poi_id": "fallback-jinying",
        "type": "060100",
    }),
    (("艾尚天地",), {
        "name": "艾尚天地",
        "location": "118.782456,32.042891",
        "poi_id": "fallback-aishang",
        "type": "060100",
    }),
    (("吾悦广场",), {
        "name": "南京建邺吾悦广场",
        "location": "118.731892,32.003456",
        "poi_id": "fallback-wuyue",
        "type": "060100",
    }),
    (("建邺万达", "万达广场"), {
        "name": "万达广场(南京建邺店)",
        "location": "118.731234,32.004567",
        "poi_id": "fallback-wanda",
        "type": "060100",
    }),
    (("万象天地",), {
        "name": "南京万象天地",
        "location": "118.778901,32.045678",
        "poi_id": "fallback-mixc",
        "type": "060100",
    }),
)

# 从用户句中提取待高德验证的地点片段（非商场词表）
_LOCATION_EXTRACT_PATTERNS = (
    re.compile(r"^([\u4e00-\u9fffA-Za-z0-9·]{2,16}?)里"),
    re.compile(r"^([\u4e00-\u9fffA-Za-z0-9·]{2,16}?)内"),
    re.compile(r"^([\u4e00-\u9fffA-Za-z0-9·]{2,16}?)里面"),
    re.compile(r"^([\u4e00-\u9fffA-Za-z0-9·]{2,16}?)附近"),
    re.compile(r"^([\u4e00-\u9fffA-Za-z0-9·]{2,16}?)周边"),
    re.compile(r"在([\u4e00-\u9fffA-Za-z0-9·]{2,16}?)"),
    re.compile(
        r"^([\u4e00-\u9fffA-Za-z0-9·]{2,16}?)(?:有什么|有啥)(?:吃|玩|逛|买|喝)"
    ),
    re.compile(
        r"([\u4e00-\u9fff]{2,12}(?:广场|百货|购物中心|商城|万达|天街|吾悦|"
        r"万象天地|大悦城|印象城|来福士|奥莱|奥特莱斯))"
    ),
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

_MALL_AROUND_RADIUS_M = 800

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


def _location_stopwords():
    stop = {
        "附近", "周边", "周围", "里面", "有什么", "有啥", "推荐", "请问", "帮忙",
        "今天", "明天", "晚上", "中午", "我想", "想要", "可以", "能不能",
    }
    for alias, campus in _CAMPUS_IN_MESSAGE:
        stop.add(alias)
        if campus in GUIDE_CAMPUS_COORDS:
            stop.add(campus)
    for marker, _ in _CUISINE_KEYWORDS:
        stop.add(marker)
    for markers in (_FOOD_INTENT, _FUN_MARKERS, _SPORT_MARKERS, _SCENIC_MARKERS):
        for m in markers:
            if len(m) >= 2:
                stop.add(m)
    return stop


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


def extract_location_queries(message: str):
    """从消息提取地点检索词（规则抽取，非商场词表）；须再高德验证为商场 POI。"""
    text = (message or "").strip()
    if not text:
        return []
    stop = _location_stopwords()
    queries = []
    seen = set()

    def _add(raw):
        q = (raw or "").strip()
        if len(q) < 2 or q in stop:
            return
        if q in seen:
            return
        seen.add(q)
        queries.append(q)

    for pat in _LOCATION_EXTRACT_PATTERNS:
        for match in pat.finditer(text):
            _add(match.group(1))

    return queries


def detect_mall_keyword(message: str):
    """兼容旧接口：返回首个地点检索词，是否商场由 resolve_mall_anchor 判定。"""
    queries = extract_location_queries(message)
    return queries[0] if queries else None


def _parse_amap_type_codes(type_str):
    codes = []
    raw = str(type_str or "").strip()
    for part in raw.split(";"):
        part = part.strip()
        if re.fullmatch(r"\d{6}", part):
            codes.append(part)
        elif re.fullmatch(r"\d{3,6}", part):
            codes.append(part.zfill(6))
    return codes


def is_mall_amap_poi(poi) -> bool:
    """高德 POI 是否为购物中心（060100）。"""
    if not isinstance(poi, dict):
        return False
    codes = _parse_amap_type_codes(poi.get("type"))
    if any(c == _AMAP_MALL_TYPE_CODE or c.startswith(_AMAP_MALL_TYPE_CODE) for c in codes):
        return True
    type_str = str(poi.get("type") or "")
    return _AMAP_MALL_TYPE_CODE in type_str


def _score_mall_poi(poi, query):
    """商场锚点 POI 打分：须已通过 is_mall_amap_poi；名称与 query 越近越好。"""
    if not is_mall_amap_poi(poi):
        return -1.0
    name = (poi.get("name") or "").strip()
    if not name:
        return -1.0
    score = 5.0
    q = (query or "").strip()
    if q and q in name:
        score += 3.0
    if q and (name.startswith(q) or (len(q) >= 2 and q[:2] in name)):
        score += 1.0
    if any(m in name for m in ("写字楼", "公寓", "酒店", "停车场")):
        score -= 2.0
    try:
        dist = float(poi.get("distance") or 0)
        if dist >= 0:
            score += max(0.0, 1.0 - dist / 5000.0)
    except (TypeError, ValueError):
        pass
    return score


def _collect_mall_poi_candidates(query, city="南京"):
    """inputtips / place/text 拉取 POI，仅保留购物中心(060100)。"""
    candidates = []
    seen = set()

    def _add(poi):
        if not is_mall_amap_poi(poi):
            return
        loc = str(poi.get("location") or "").strip()
        name = (poi.get("name") or "").strip()
        if not loc or "," not in loc or not name:
            return
        poi_id = str(poi.get("id") or "").strip()
        key = poi_id or name
        if key in seen:
            return
        seen.add(key)
        candidates.append({
            "name": name,
            "location": loc,
            "poi_id": poi_id,
            "type": poi.get("type") or "",
            "distance": poi.get("distance"),
        })

    try:
        tips_data = inputtips(query, city=city)
        for tip in tips_data.get("tips") or []:
            _add(tip)
    except Exception:
        pass

    try:
        result = search_places(query, city=city, types=_AMAP_MALL_TYPE_CODE, page_size=15)
        if str(result.get("status")) == "1":
            for poi in result.get("pois") or []:
                _add(poi)
    except Exception:
        pass

    return candidates


def _fallback_mall_anchor(query: str):
    """高德不可用时的内置商场锚点。"""
    q = (query or "").strip()
    if len(q) < 2:
        return None
    for keywords, anchor in _KNOWN_MALL_ANCHORS:
        for kw in keywords:
            if kw in q or q in kw:
                return {
                    "name": anchor["name"],
                    "location": anchor["location"],
                    "keyword": q,
                    "poi_id": anchor.get("poi_id") or "",
                }
    return None


def resolve_mall_anchor(message: str, city="南京"):
    """抽取地点 → 高德检索 → 分类码为购物中心(060100) 才作为商场锚点。"""
    queries = extract_location_queries(message)
    if not queries:
        return None

    best = None
    best_score = -1.0
    best_query = ""

    for query in queries:
        for poi in _collect_mall_poi_candidates(query, city=city):
            score = _score_mall_poi(
                {"name": poi["name"], "type": poi.get("type"), "distance": poi.get("distance")},
                query,
            )
            if score > best_score:
                best_score = score
                best = poi
                best_query = query

    if best and best_score >= 0:
        return {
            "name": best["name"],
            "location": best["location"],
            "keyword": best_query,
            "poi_id": best.get("poi_id") or "",
        }

    for query in queries:
        fallback = _fallback_mall_anchor(query)
        if fallback:
            return fallback
    return None


def _resolve_mall_shop_category(message: str, category: str) -> str:
    """商场场景下解析 eat/fun/shop 子意图。"""
    text = (message or "").strip()
    if any(m in text for m in _DRINK_CATEGORY_MARKERS):
        return "咖啡饮品"
    if any(t in text for t in ("吃", "餐", "喝", "美食", "饭店", "饭", "饿")):
        return "美食"
    if any(t in text for t in _FUN_MARKERS):
        return "休闲娱乐"
    if any(t in text for t in _SPORT_MARKERS):
        return "运动健身"
    if any(t in text for t in _SCENIC_MARKERS):
        return "景点公园"
    if any(t in text for t in _SHOP_MARKERS):
        return "购物商圈"
    if category in ("美食", "咖啡饮品", "休闲娱乐", "运动健身", "购物商圈", "景点公园"):
        return category
    return "美食"


def _effective_mall_search_message(message: str, history=None) -> str:
    """澄清追问轮（如只回复「火锅」）时，合并上一轮用户消息中的地点。"""
    text = (message or "").strip()
    if extract_location_queries(text):
        return text
    if not history or not _was_awaiting_clarification(history):
        return text
    if len(text) > 8 and not _has_cuisine_or_brand(text):
        return text
    for msg in reversed(history):
        if msg.get("role") != "user":
            continue
        prev = (msg.get("content") or "").strip()
        if extract_location_queries(prev):
            return f"{prev} {text}".strip()
        break
    return text


def _resolve_mall_branch(message: str, category: str, history=None, city="南京"):
    """解析商场分支：返回 {anchor, category} 或 None。"""
    search_msg = _effective_mall_search_message(message, history=history)
    anchor = resolve_mall_anchor(search_msg, city=city)
    if not anchor:
        return None
    mall_category = _resolve_mall_shop_category(search_msg, category)
    return {"anchor": anchor, "category": mall_category, "search_message": search_msg}


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
        if resolve_mall_anchor(text):
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
    if category == "购物商圈" and re.search(r"有什么|有啥|哪些|推荐", text) and not extract_location_queries(text):
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
        scope = f"{mall_name}内/周边" if mode == "mall_anchor" and mall_name else f"{campus}校区"
        extra = ""
        if mode == "mall_anchor" and mall_name:
            extra = "请勿推荐该商场以外的门店；"
        body = (
            f"（{scope}「{category}」下未检索到 POI；{extra}"
            "候选来自吃喝玩乐同源高德 POI，请勿编造名称。）"
        )
        if hints:
            return "\n".join(hints) + "\n" + body
        return body
    scope = f"{mall_name}内/周边" if mode == "mall_anchor" and mall_name else f"{campus}校区"
    lines = [
        f"候选列表（{scope} · guide分类「{category}」· 高德固定 types）：\n"
    ]
    if mode == "mall_anchor" and mall_name:
        lines.append(
            f"【提示】以下候选以「{mall_name}」为中心周边检索，"
            "无法保证均在商场室内或具体楼层；"
            "禁止推荐列表以外的店，尤其禁止推荐商场外/新街口等其他商圈的门店。\n"
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


def _item_matches_keyword(item, keyword: str) -> bool:
    """品类/关键词检索时，名称或类型须含关键词（如「川菜」）。"""
    kw = (keyword or "").strip()
    if not kw:
        return True
    name = item.get("name") or ""
    typ = str(item.get("type") or "")
    return kw in name or kw in typ


def _fetch_campus_branch(
    *,
    campus,
    category,
    keyword,
    user_id,
):
    cache_key = ("campus", campus, category, keyword, user_id)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    kw = (keyword or "").strip()
    has_keyword = bool(kw)

    amap_items = []
    payload = search_ai_guide_places(campus, category, keyword=kw, user_id=user_id)
    if not payload.get("error"):
        amap_items.extend(payload.get("items") or [])

    if not amap_items and not has_keyword:
        payload = search_ai_guide_places(campus, category, keyword="", user_id=user_id)
        if not payload.get("error"):
            amap_items.extend(payload.get("items") or [])

    seed_items = []
    if not has_keyword and len(amap_items) < 5:
        seed_items = fetch_ai_guide_seed(campus, category)

    remote_items = dedupe_guide_items(amap_items + seed_items)
    db_items = fetch_db_leaderboard_candidates(campus, category)
    if has_keyword:
        remote_items = [i for i in remote_items if _item_matches_keyword(i, kw)]
        db_items = [i for i in db_items if _item_matches_keyword(i, kw)]

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


def _fetch_mall_branch(
    *,
    anchor,
    campus,
    category,
    keyword,
    user_id,
):
    mall_location = anchor.get("location")
    mall_name = anchor.get("name")
    mall_poi_id = anchor.get("poi_id") or ""
    cache_key = ("mall", mall_location, mall_poi_id, campus, category, keyword, user_id)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    kw = (keyword or "").strip()
    has_keyword = bool(kw)

    amap_items = []
    payload = search_guide_places_near(
        mall_location,
        category,
        keyword=kw,
        campus=campus,
        user_id=user_id,
        radius=_MALL_AROUND_RADIUS_M,
        exclude_anchor_poi_id=mall_poi_id,
        exclude_anchor_name=mall_name,
        mall_shop_mode=True,
    )
    if not payload.get("error"):
        amap_items.extend(payload.get("items") or [])

    if not amap_items and not has_keyword:
        payload = search_guide_places_near(
            mall_location,
            category,
            keyword="",
            campus=campus,
            user_id=user_id,
            radius=_MALL_AROUND_RADIUS_M,
            exclude_anchor_poi_id=mall_poi_id,
            exclude_anchor_name=mall_name,
            mall_shop_mode=True,
        )
        if not payload.get("error"):
            amap_items.extend(payload.get("items") or [])

    if has_keyword:
        amap_items = [i for i in amap_items if _item_matches_keyword(i, kw)]

    remote_items = dedupe_guide_items(amap_items)
    if remote_items:
        remote_items = enrich_guide_items(
            remote_items,
            user_id=user_id,
            campus=campus,
            category=category,
        )

    items = remote_items
    if items:
        _cache_set(cache_key, items)
    return items


def _fetch_guide_items(
    *,
    mode,
    campus,
    category,
    keyword,
    user_id,
    mall_anchor=None,
):
    """兼容旧调用：按 mode 分发 campus / mall 分支。"""
    if mode == "mall_anchor" and mall_anchor:
        return _fetch_mall_branch(
            anchor=mall_anchor,
            campus=campus,
            category=category,
            keyword=keyword,
            user_id=user_id,
        )
    return _fetch_campus_branch(
        campus=campus,
        category=category,
        keyword=keyword,
        user_id=user_id,
    )


def _empty_context(message, user_id=None):
    campus = resolve_campus(message, user_id=user_id)
    return {
        "is_guide_request": False,
        "is_food_request": False,
        "is_partner_request": False,
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
        "posts_api": [],
    }


_PARTNER_TYPES = (
    "饭搭子", "运动搭子", "学习搭子", "游戏搭子", "电影搭子",
    "旅游搭子", "音乐搭子", "摄影搭子", "其他",
)
_PARTNER_MARKERS = (
    "组局", "搭子", "找搭子", "征友", "缺人", "一起", "来人", "组队",
    "有什么活动", "有没有活动", "谁想", "有没有人", "报名",
)


def detect_partner_intent(message):
    msg = (message or "").strip()
    if not msg:
        return None
    matched_type = next((t for t in _PARTNER_TYPES if t in msg), None)
    has_marker = any(marker in msg for marker in _PARTNER_MARKERS)
    if not has_marker and not matched_type:
        return None
    return {
        "type_tag": matched_type,
        "keyword": _extract_partner_keyword(msg, matched_type),
    }


def _extract_partner_keyword(message, type_tag=None):
    kw = message
    for token in _PARTNER_TYPES:
        kw = kw.replace(token, " ")
    for token in _PARTNER_MARKERS:
        kw = kw.replace(token, " ")
    for token in ("仙林", "鼓楼", "浦口", "苏州", "南大", "附近", "有没有", "什么", "哪些", "查询", "看看", "帮我"):
        kw = kw.replace(token, " ")
    kw = re.sub(r"\s+", " ", kw).strip(" ，。！？?")
    if len(kw) < 2:
        return None
    return kw[:30]


def _format_partner_event_time(post):
    event_time = post.get("event_time")
    if event_time:
        return str(event_time).replace("T", " ")[:16]
    urgency = post.get("urgency")
    if urgency == "long_term":
        return "长期征友"
    if urgency == "now":
        return "立即/进行中"
    return "时间未定"


def _partner_posts_to_llm_text(posts):
    if not posts:
        return (
            "【本地组局帖子（找搭子模块）】\n"
            "当前没有检索到匹配的组局。请如实告知用户，并建议去「找搭子」页发布或调整关键词/类型。"
        )
    lines = ["【本地组局帖子（找搭子模块）】以下是系统检索结果，请只引用这些条目："]
    for index, post in enumerate(posts, 1):
        tags = "、".join(post.get("tags") or []) or "未分类"
        location = post.get("location_name") or "地点未定"
        participant_count = post.get("participant_count") or 1
        max_participants = post.get("max_participants") or 2
        budget = post.get("budget") or "未填"
        username = post.get("username") or "匿名"
        lines.append(
            f"{index}. [帖子#{post.get('id')}] 《{post.get('title')}》"
            f" | 标签：{tags}"
            f" | 时间：{_format_partner_event_time(post)}"
            f" | 地点：{location}"
            f" | 人数：{participant_count}/{max_participants}"
            f" | 预算：{budget}"
            f" | 发起人：{username}"
        )
    lines.append("请根据列表回答；引导用户去「找搭子」页查看详情或报名。禁止编造列表外的活动。")
    return "\n".join(lines)


def _build_partner_context(message, user_id=None):
    intent = detect_partner_intent(message)
    if not intent:
        return None

    from app.services.note import NoteSystem

    ns = NoteSystem(user_id=user_id)
    tags = [intent["type_tag"]] if intent.get("type_tag") else None
    keyword = intent.get("keyword")
    result = ns.search(
        tags=tags,
        keyword=keyword,
        sort="hot",
        page=1,
        page_size=8,
    )
    posts = result.get("items") or []
    campus = resolve_campus(message, user_id=user_id)
    posts_text = _partner_posts_to_llm_text(posts)
    return {
        "is_guide_request": False,
        "is_food_request": False,
        "is_partner_request": True,
        "needs_clarification": False,
        "candidates": [],
        "candidates_api": [],
        "candidates_text": posts_text,
        "posts_api": [
            {"id": post["id"], "title": post["title"], "tags": post.get("tags") or []}
            for post in posts
        ],
        "clarification_text": "",
        "clarification_chips": [],
        "campus": campus,
        "category": None,
        "mode": "partner",
        "mall_name": None,
    }


def _merge_partner_context(ctx, partner_ctx):
    if not partner_ctx:
        return ctx
    ctx["is_partner_request"] = True
    ctx["posts_api"] = partner_ctx.get("posts_api") or []
    partner_text = partner_ctx.get("candidates_text") or ""
    if ctx.get("candidates_text"):
        ctx["candidates_text"] = f"{partner_text}\n\n{ctx['candidates_text']}"
    else:
        ctx["candidates_text"] = partner_text
    if ctx.get("mode") not in ("mall_anchor", "partner"):
        ctx["mode"] = f"partner+{ctx.get('mode') or 'guide'}"
    return ctx


def prepare_chat_recommend_context(message, user_id=None, gps_location=None, history=None):
    """
    为 chat_recommend 准备候选与 LLM 上下文。
    检索链：intent → mall_branch 或 campus_branch；商场无结果时 fallback 校区。
    组局意图时附加找搭子模块本地帖子。
    """
    partner_ctx = _build_partner_context(message, user_id=user_id)
    category = classify_guide_intent(message)
    if not category and not partner_ctx:
        return _empty_context(message, user_id=user_id)
    if not category and partner_ctx:
        return partner_ctx

    campus = resolve_campus(message, user_id=user_id)
    city = guide_search_city(campus)
    mall_branch = _resolve_mall_branch(message, category, history=history, city=city)
    mode = "mall_anchor" if mall_branch else "campus"
    mall_anchor = mall_branch.get("anchor") if mall_branch else None
    mall_name = mall_anchor.get("name") if mall_anchor else None

    if mall_branch:
        category = mall_branch["category"]

    if not mall_branch and needs_guide_clarification(message, category, history=history):
        chips = clarification_chips_for(category)
        clar_text = _clarification_context_text(message, campus, category)
        if mall_name:
            clar_text += f" 用户已指定商场「{mall_name}」，追问时说明会在该商场内/周边检索。"
        return _merge_partner_context({
            "is_guide_request": True,
            "is_food_request": category in ("美食", "咖啡饮品"),
            "is_partner_request": False,
            "needs_clarification": True,
            "candidates": [],
            "candidates_api": [],
            "candidates_text": "",
            "clarification_text": clar_text,
            "clarification_chips": chips,
            "campus": campus,
            "category": category,
            "mode": mode,
            "mall_name": mall_name,
            "posts_api": [],
        }, partner_ctx)

    keyword = resolve_guide_keyword(message, category)
    gps_lng, gps_lat = _parse_loc(gps_location) if gps_location else (None, None)

    hints = []
    items = []
    if mall_branch:
        items = _fetch_mall_branch(
            anchor=mall_anchor,
            campus=campus,
            category=category,
            keyword=keyword,
            user_id=user_id,
        )
        if not items:
            hints.append(
                f"【提示】「{mall_name}」内/周边未检索到「{keyword or category}」相关店铺。"
                "请勿推荐商场外或其他商圈的门店；如实说明暂无合适候选即可。"
            )
    else:
        items = _fetch_campus_branch(
            campus=campus,
            category=category,
            keyword=keyword,
            user_id=user_id,
        )

    ranked = _rank_items(message, items, category=category)
    candidates = _guide_items_to_candidates(
        ranked[:8], gps_lng, gps_lat, category=category, campus=campus,
    )[:5]

    if any(h in message for h in _AMBIANCE_HINT):
        hints.append(
            "【提示】用户问氛围（安静等），数据无此标签；说明只能按距离/评分推荐。"
        )
    if category in _CATEGORY_SHOWS_COST and any(h in message for h in _BUDGET_HINT):
        hints.append("【提示】用户在意价格，优先推荐人均较低的候选。")
    if any(h in message for h in _RATING_HINT):
        hints.append("【提示】用户在意评分，优先推荐评分高的候选。")

    return _merge_partner_context({
        "is_guide_request": True,
        "is_food_request": category in ("美食", "咖啡饮品"),
        "is_partner_request": False,
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
        "posts_api": [],
    }, partner_ctx)
