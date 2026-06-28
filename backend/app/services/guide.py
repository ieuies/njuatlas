"""吃喝玩乐 guide 页：距离排序候选 + 点赞排行榜。"""

import json
import random
import re
import time

from sqlalchemy import func

from app import db
from app.models import Like, Place, Review
from app.services.amap import search_places


GUIDE_CAMPUS_COORDS = {
    "鼓楼": "118.780,32.058",
    "仙林": "118.954,32.114",
    "浦口": "118.652,32.157",
    "苏州": "120.39,31.36",
}

GUIDE_SEARCH_RADIUS = 5000
GUIDE_PAGE_SIZE = 25
GUIDE_SORT_RULE = "distance"
GUIDE_LEADERBOARD_LIMIT = 10
GUIDE_MAX_DISTANCE_M = 8000
GUIDE_CANDIDATE_PAGES = 1
_SEED_CACHE_TTL_SEC = 300
_seed_cache = {}

GUIDE_CATEGORY_CONFIG = {
    "美食": {"types": "050000", "keyword": "", "max_pages": 1},
    "咖啡饮品": {"types": "050500|050600|050700|050900", "keyword": "", "max_pages": 1},
    "休闲娱乐": {"types": "080300|080600", "keyword": "", "max_pages": 1},
    "运动健身": {"types": "080100", "keyword": "", "max_pages": 1},
    "购物商圈": {"types": "060100|061000", "keyword": "", "max_pages": 1},
    "景点公园": {
        "types": "110000|140100|140200|140300|140400|140500",
        "keyword": "",
        "max_pages": 1,
    },
}


# AI 小鲸灵允许检索的全部分类（与 guide 页 GUIDE_CATEGORY_CONFIG 一致）
AI_GUIDE_CATEGORIES = tuple(GUIDE_CATEGORY_CONFIG.keys())
# 兼容旧名
AI_DINING_CATEGORIES = AI_GUIDE_CATEGORIES


def guide_search_city(campus):
    return "苏州" if campus == "苏州" else "南京"


def guide_config_payload():
    return {
        "campuses": GUIDE_CAMPUS_COORDS,
        "categories": GUIDE_CATEGORY_CONFIG,
        "search_radius": GUIDE_SEARCH_RADIUS,
        "page_size": GUIDE_PAGE_SIZE,
        "sortrule": GUIDE_SORT_RULE,
        "leaderboard_limit": GUIDE_LEADERBOARD_LIMIT,
    }


GUIDE_EXCLUDED_NAME_KEYWORDS = (
    "南京大学",
    "南大",
    "酒店",
    "宾馆",
    "旅馆",
    "青年公寓",
    "公寓",
    "手工店",
    "陶艺",
    "石膏",
    "世界贸易",
    "贸易中心",
    "写字楼",
    "商业中心",
    "购物中心",
    "政府部门",
    "商学院",
    "烟酒",
    "烟草",
    "便利店",
)

_FOOD_AMAP_TYPE_TEXT_MARKERS = (
    "餐饮", "餐厅", "饭店", "咖啡", "奶茶", "小吃", "火锅", "烧烤",
    "面馆", "饺子", "烘焙", "甜品", "饮品", "中餐", "西餐", "日料",
    "韩国料理", "快餐", "早餐", "茶楼", "茶餐厅", "酒吧", "烤肉", "食堂",
)
_NON_FOOD_AMAP_TYPE_TEXT_MARKERS = (
    "贸易", "写字楼", "金融", "政府", "风景名胜", "商务住宅", "公司企业",
    "科教文化", "交通设施", "汽车服务", "医疗保健", "购物服务", "烟酒",
)
_RESTAURANT_NAME_MARKERS = (
    "餐", "饭", "面", "馆", "店", "咖啡", "奶茶", "烧烤", "火锅", "小吃",
    "厨", "灶", "食", "坊", "斋", "酒楼", "酒家", "料理", "寿司", "披萨",
    "麦当劳", "肯德基", "星巴克", "海底捞", "必胜客", "萨莉亚", "馄饨", "水饺",
)
# 校外分店后缀，如「李记吊笼牛肉汤(南京大学店)」
_GUIDE_CAMPUS_BRANCH_SUFFIX_RE = re.compile(
    r"\([^)]*(南京大学|南大)[^)]*店\)"
)
_LB_RESPONSE_CACHE_TTL_SEC = 120
_lb_response_cache = {}


def _normalize_poi_name(name):
    return (name or "").strip().replace("（", "(").replace("）", ")")


def is_excluded_guide_poi_name(name, skip_keywords=None):
    normalized = _normalize_poi_name(name)
    if not normalized:
        return False
    skip = frozenset(skip_keywords or ())
    for keyword in GUIDE_EXCLUDED_NAME_KEYWORDS:
        if keyword in skip:
            continue
        if keyword not in normalized:
            continue
        if keyword in ("南京大学", "南大") and _GUIDE_CAMPUS_BRANCH_SUFFIX_RE.search(normalized):
            continue
        return True
    return False


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


def is_food_amap_poi(poi):
    """判断高德 POI 是否属于餐饮/饮品店，过滤贸易中心、写字楼等非餐饮结果。"""
    if not isinstance(poi, dict):
        return False
    name = _normalize_poi_name(poi.get("name"))
    if not name or is_excluded_guide_poi_name(name):
        return False

    type_str = str(poi.get("type") or "").strip()
    codes = _parse_amap_type_codes(type_str)
    if codes:
        return any(code.startswith("05") for code in codes)

    if type_str:
        if any(marker in type_str for marker in _NON_FOOD_AMAP_TYPE_TEXT_MARKERS):
            return False
        if any(marker in type_str for marker in _FOOD_AMAP_TYPE_TEXT_MARKERS):
            return True
        if type_str.startswith("osm:"):
            return True

    return any(marker in name for marker in _RESTAURANT_NAME_MARKERS)


def filter_guide_items(items):
    return [item for item in items if not is_excluded_guide_poi_name(item.get("name"))]


def _secure_image_url(url):
    if not url:
        return ""
    url = str(url).strip()
    if url.startswith("http://"):
        return "https://" + url[len("http://"):]
    return url


def _parse_distance_m(poi):
    try:
        value = float(poi.get("distance"))
    except (TypeError, ValueError):
        return None
    if value < 0:
        return None
    return int(value)


def _poi_to_item(poi, cat, campus):
    biz = poi.get("biz_ext") or {}
    cost = biz.get("cost")
    raw_image = (poi.get("photos") or [{}])[0].get("url", "") if poi.get("photos") else ""
    distance_m = _parse_distance_m(poi)
    return {
        "poi_id": str(poi.get("id") or "").strip(),
        "name": poi.get("name") or "",
        "desc": poi.get("address") or "",
        "image": _secure_image_url(raw_image),
        "type": cat,
        "campus": campus,
        "rating": biz.get("rating", "") or "",
        "price": f"¥{cost}/人" if cost else "",
        "address": poi.get("address") or "",
        "location": poi.get("location") or "",
        "distance_m": distance_m,
        "distance_label": f"{distance_m}m" if distance_m is not None else "",
    }


def _dedupe_key(item):
    poi_id = (item.get("poi_id") or "").strip()
    if poi_id:
        return f"poi:{poi_id}"
    name = (item.get("name") or "").strip()
    address = (item.get("address") or "").strip()
    return f"name:{name}|addr:{address}"


def dedupe_guide_items(items):
    seen = set()
    deduped = []
    for item in items:
        key = _dedupe_key(item)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _parse_rating(value):
    try:
        rating = float(value)
    except (TypeError, ValueError):
        return 0.0
    if rating < 0:
        return 0.0
    return rating


def effective_rating(item):
    amap_rating = _parse_rating(item.get("rating"))
    platform_rating = _parse_rating(item.get("platform_rating"))
    if platform_rating and amap_rating:
        return max(amap_rating, platform_rating)
    return platform_rating or amap_rating


def _normalize_like_count(item):
    try:
        return max(0, int(item.get("like_count") or 0))
    except (TypeError, ValueError):
        return 0


def leaderboard_sort_key(item):
    return (
        -_normalize_like_count(item),
        -(int(item.get("review_count") or 0)),
        -effective_rating(item),
        item.get("distance_m") if item.get("distance_m") is not None else 999999,
    )


def fetch_guide_category(campus, cat, cfg=None):
    """按距离拉取校区周边候选 POI（人工规则过滤后用于排行榜种子）。"""
    cache_key = (campus, cat)
    cached = _seed_cache.get(cache_key)
    if cached and time.time() - cached[0] < _SEED_CACHE_TTL_SEC:
        return cached[1]

    cfg = cfg or GUIDE_CATEGORY_CONFIG[cat]
    location = GUIDE_CAMPUS_COORDS.get(campus, GUIDE_CAMPUS_COORDS["鼓楼"])
    city = guide_search_city(campus)
    max_pages = cfg.get("max_pages", GUIDE_CANDIDATE_PAGES)
    target_count = max_pages * GUIDE_PAGE_SIZE

    items = []
    seen = set()
    page = 1
    while page <= max_pages and len(items) < target_count:
        result = search_places(
            cfg["keyword"],
            city=city,
            location=location,
            page=page,
            page_size=GUIDE_PAGE_SIZE,
            radius=GUIDE_SEARCH_RADIUS,
            types=cfg["types"],
            sortrule=GUIDE_SORT_RULE,
        )
        if result.get("status") != "1":
            break
        batch = result.get("pois") or []
        if not batch:
            break
        for poi in batch:
            if cat in ("美食", "咖啡饮品") and not is_food_amap_poi(poi):
                continue
            item = _poi_to_item(poi, cat, campus)
            if is_excluded_guide_poi_name(item["name"]):
                continue
            dist = item.get("distance_m")
            if dist is not None and dist > GUIDE_MAX_DISTANCE_M:
                continue
            key = _dedupe_key(item)
            if key in seen:
                continue
            seen.add(key)
            items.append(item)
            if len(items) >= target_count:
                break
        page += 1
    _seed_cache[cache_key] = (time.time(), items)
    return items


def _name_addr_key(name, address=""):
    name = (name or "").strip().lower()
    address = (address or "").strip().lower()
    if not name:
        return ""
    return f"{name}|{address}"


def enrich_guide_items(items, user_id=None, campus=None, category=None):
    if not items:
        return items

    poi_ids = [item["poi_id"] for item in items if item.get("poi_id")]
    places_by_poi = {}
    if poi_ids:
        for place in Place.query.filter(Place.poi_id.in_(poi_ids)).all():
            places_by_poi[place.poi_id] = place

    direct_place_ids = [item["place_id"] for item in items if item.get("place_id")]
    places_by_id = {}
    if direct_place_ids:
        for place in Place.query.filter(Place.id.in_(direct_place_ids)).all():
            places_by_id[place.id] = place

    places_by_name = {}
    name_key_place_ids = {}
    if category and items:
        item_names = list({
            (item.get("name") or "").strip()
            for item in items
            if (item.get("name") or "").strip()
        })
        if item_names:
            place_q = Place.query.filter(
                Place.guide_category == category,
                Place.name.in_(item_names),
            )
            if campus and campus not in ("", "all"):
                place_q = place_q.filter(Place.campus == campus)
            for place in place_q.all():
                places_by_id[place.id] = place
                if place.poi_id:
                    places_by_poi.setdefault(place.poi_id, place)
                name_key = _name_addr_key(place.name, place.address)
                if name_key:
                    name_key_place_ids.setdefault(name_key, []).append(place.id)
                    places_by_name.setdefault(name_key, place)

    if user_id:
        liked_q = (
            db.session.query(Place)
            .join(Like, Like.place_id == Place.id)
            .filter(Like.user_id == user_id)
        )
        if category:
            liked_q = liked_q.filter(Place.guide_category == category)
        for place in liked_q.all():
            places_by_id[place.id] = place
            if place.poi_id:
                places_by_poi.setdefault(place.poi_id, place)
            name_key = _name_addr_key(place.name, place.address)
            if name_key:
                places_by_name.setdefault(name_key, place)

    place_ids = list(
        {place.id for place in places_by_poi.values()}
        | set(places_by_id.keys())
        | {place.id for place in places_by_name.values()}
    )
    like_counts = {}
    review_counts = {}
    review_avg = {}
    user_liked = set()
    if place_ids:
        like_counts = dict(
            db.session.query(Like.place_id, func.count(Like.id))
            .filter(Like.place_id.in_(place_ids))
            .group_by(Like.place_id)
            .all()
        )
        review_rows = (
            db.session.query(
                Review.place_id,
                func.count(Review.id),
                func.avg(Review.rating),
            )
            .filter(Review.place_id.in_(place_ids), Review.rating.isnot(None))
            .group_by(Review.place_id)
            .all()
        )
        for place_id, count, avg in review_rows:
            review_counts[place_id] = count
            if avg is not None:
                review_avg[place_id] = round(float(avg), 1)

        if user_id:
            user_liked = {
                row[0]
                for row in db.session.query(Like.place_id)
                .filter(Like.user_id == user_id, Like.place_id.in_(place_ids))
                .all()
            }

    name_key_like_sum = {}
    for name_key, pids in name_key_place_ids.items():
        name_key_like_sum[name_key] = sum(like_counts.get(pid, 0) for pid in pids)
        if len(pids) > 1:
            best_id = max(pids, key=lambda pid: like_counts.get(pid, 0))
            places_by_name[name_key] = places_by_id.get(best_id) or places_by_name.get(name_key)

    enriched = []
    for item in items:
        row = dict(item)
        place = (
            places_by_poi.get(row.get("poi_id") or "")
            or places_by_id.get(row.get("place_id"))
            or places_by_name.get(_name_addr_key(row.get("name"), row.get("address")))
        )
        like_count = 0
        review_count = 0
        platform_rating = None
        if place:
            name_key = _name_addr_key(row.get("name"), row.get("address"))
            like_count = name_key_like_sum.get(name_key, like_counts.get(place.id, 0))
            review_count = review_counts.get(place.id, 0)
            if place.avg_rating is not None:
                platform_rating = round(float(place.avg_rating), 1)
            elif place.id in review_avg:
                platform_rating = review_avg[place.id]
            row["place_id"] = place.id

        row["like_count"] = like_count
        row["review_count"] = review_count
        row["liked"] = bool(
            place
            and (
                place.id in user_liked
                or any(pid in user_liked for pid in name_key_place_ids.get(name_key, [place.id]))
            )
        )
        if platform_rating is not None:
            row["platform_rating"] = platform_rating
            display = effective_rating(row)
            if display:
                row["rating"] = str(display)
        enriched.append(row)
    return enriched


def _place_row_to_item(place, cat, campus, like_count=0, review_count=0):
    photos = []
    if place.photos:
        try:
            photos = json.loads(place.photos)
        except (json.JSONDecodeError, TypeError):
            photos = []
    image = photos[0] if photos else ""
    return {
        "poi_id": place.poi_id or "",
        "place_id": place.id,
        "name": place.name or "",
        "desc": place.address or "",
        "image": _secure_image_url(image),
        "type": cat,
        "campus": campus or place.campus or "",
        "rating": str(place.avg_rating) if place.avg_rating else "",
        "price": "",
        "address": place.address or "",
        "location": place.location or "",
        "like_count": like_count,
        "review_count": review_count,
    }


def fetch_db_leaderboard_candidates(campus, cat):
    """站内已收录、有点赞的店铺可冲入排行榜（likes 表为真源，Redis 仅作回填）。"""
    from app.services.guide_rank_cache import warm_rank_cache

    q = (
        db.session.query(Place, func.count(Like.id).label("likes"))
        .outerjoin(Like, Like.place_id == Place.id)
        .filter(Place.guide_category == cat)
        .group_by(Place.id)
        .having(func.count(Like.id) > 0)
    )
    if campus and campus != "all":
        q = q.filter(Place.campus == campus)

    rows = q.all()
    warm_rank_cache(campus, cat, [(place.id, likes) for place, likes in rows])
    place_ids = [place.id for place, _likes in rows]
    review_counts = {}
    if place_ids:
        review_counts = dict(
            db.session.query(Review.place_id, func.count(Review.id))
            .filter(Review.place_id.in_(place_ids))
            .group_by(Review.place_id)
            .all()
        )
    items = []
    for place, likes in rows:
        review_count = review_counts.get(place.id, 0)
        items.append(_place_row_to_item(place, cat, campus, like_count=likes, review_count=review_count))
    return items


def merge_leaderboard_candidates(seed_items, db_items):
    merged = {}
    # 数据库条目优先，避免高德种子覆盖已有赞数
    for item in db_items + seed_items:
        key = _dedupe_key(item)
        if key not in merged:
            merged[key] = dict(item)
            continue
        existing = merged[key]
        for field in ("like_count", "review_count", "place_id", "image", "rating"):
            if not existing.get(field) and item.get(field):
                existing[field] = item[field]
        if (item.get("like_count") or 0) > (existing.get("like_count") or 0):
            existing["like_count"] = item["like_count"]
    return list(merged.values())


def _shuffle_same_like_tier(items):
    if not items:
        return items
    grouped = []
    i = 0
    while i < len(items):
        score = leaderboard_sort_key(items[i])[:1]
        j = i + 1
        while j < len(items) and leaderboard_sort_key(items[j])[:1] == score:
            j += 1
        bucket = items[i:j]
        random.shuffle(bucket)
        grouped.extend(bucket)
        i = j
    return grouped


def rank_leaderboard(items, limit=None, random_order=False, user_id=None, campus=None, category=None):
    limit = limit or GUIDE_LEADERBOARD_LIMIT
    items = dedupe_guide_items(filter_guide_items(items))
    items = enrich_guide_items(items, user_id=user_id, campus=campus, category=category)

    liked = [item for item in items if _normalize_like_count(item) > 0]
    unliked = [item for item in items if _normalize_like_count(item) == 0]
    liked.sort(key=leaderboard_sort_key)
    unliked.sort(key=leaderboard_sort_key)

    if random_order:
        liked = _shuffle_same_like_tier(liked)
        unliked = _shuffle_same_like_tier(unliked)

    items = (liked + unliked)[:limit]
    for idx, item in enumerate(items, start=1):
        item["rank"] = idx
    return items


def search_guide_places(campus, category, keyword="", page=1, page_size=None, user_id=None):
    """按校区+分类搜索周边 POI，返回与排行榜一致的结构化条目。"""
    if category not in GUIDE_CATEGORY_CONFIG:
        return {"items": [], "page": page, "has_more": False, "total": 0}

    effective_campus = campus
    if campus == "all" or campus not in GUIDE_CAMPUS_COORDS:
        effective_campus = "鼓楼"

    cfg = GUIDE_CATEGORY_CONFIG[category]
    page_size = page_size or GUIDE_PAGE_SIZE
    location = GUIDE_CAMPUS_COORDS[effective_campus]
    city = guide_search_city(effective_campus)
    keyword = (keyword or "").strip()
    sortrule = "weight" if keyword else GUIDE_SORT_RULE

    result = search_places(
        keyword or cfg.get("keyword", ""),
        city=city,
        location=location,
        page=page,
        page_size=page_size,
        radius=GUIDE_SEARCH_RADIUS,
        types=cfg["types"],
        sortrule=sortrule,
    )
    if result.get("status") != "1":
        return {"items": [], "page": page, "has_more": False, "total": 0, "error": True}

    items = []
    food_categories = {"美食", "咖啡饮品"}
    for poi in result.get("pois") or []:
        if category in food_categories and not is_food_amap_poi(poi):
            continue
        item = _poi_to_item(poi, category, effective_campus)
        if is_excluded_guide_poi_name(item["name"]):
            continue
        dist = item.get("distance_m")
        if dist is not None and dist > GUIDE_MAX_DISTANCE_M:
            continue
        items.append(item)

    items = enrich_guide_items(
        dedupe_guide_items(items),
        user_id=user_id,
        campus=effective_campus,
        category=category,
    )
    try:
        total = int(result.get("count") or 0)
    except (TypeError, ValueError):
        total = len(items)
    has_more = page * page_size < total

    return {
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
        "has_more": has_more,
        "campus": effective_campus,
        "category": category,
        "keyword": keyword,
        "campus_fallback": campus == "all" or campus not in GUIDE_CAMPUS_COORDS,
    }


def search_ai_guide_places(campus, category, keyword="", user_id=None, page=1):
    """
    AI 小鲸灵候选检索：与 guide-search 相同。
    仅允许 GUIDE_CATEGORY_CONFIG 中的分类；高德 types 固定。
    """
    if category not in GUIDE_CATEGORY_CONFIG:
        category = "美食"
    return search_guide_places(
        campus, category, keyword=(keyword or "").strip(), page=page, user_id=user_id,
    )


def search_ai_dining_places(campus, category, keyword="", user_id=None, page=1):
    """兼容旧调用方。"""
    return search_ai_guide_places(campus, category, keyword=keyword, user_id=user_id, page=page)


def search_guide_places_near(
    location,
    category,
    keyword="",
    campus="鼓楼",
    user_id=None,
    page=1,
    page_size=None,
    radius=800,
    exclude_anchor_poi_id=None,
    exclude_anchor_name=None,
    mall_shop_mode=False,
):
    """以给定坐标为锚点周边检索（商场分支等）。"""
    if category not in GUIDE_CATEGORY_CONFIG:
        category = "美食"
    if not location or "," not in str(location):
        return {"items": [], "page": page, "has_more": False, "total": 0, "error": True}

    cfg = GUIDE_CATEGORY_CONFIG[category]
    page_size = page_size or GUIDE_PAGE_SIZE
    effective_campus = campus if campus in GUIDE_CAMPUS_COORDS else "鼓楼"
    city = guide_search_city(effective_campus)
    keyword = (keyword or "").strip()
    skip_keywords = ("购物中心",) if mall_shop_mode else None
    exclude_poi_id = (exclude_anchor_poi_id or "").strip()
    exclude_name = _normalize_poi_name(exclude_anchor_name)

    result = search_places(
        keyword or cfg.get("keyword", ""),
        city=city,
        location=location,
        page=page,
        page_size=page_size,
        radius=radius,
        types=cfg["types"],
        sortrule="distance",
    )
    if result.get("status") != "1":
        return {"items": [], "page": page, "has_more": False, "total": 0, "error": True}

    items = []
    food_categories = {"美食", "咖啡饮品"}
    for poi in result.get("pois") or []:
        if category in food_categories and not is_food_amap_poi(poi):
            continue
        item = _poi_to_item(poi, category, effective_campus)
        poi_id = (item.get("poi_id") or "").strip()
        if exclude_poi_id and poi_id == exclude_poi_id:
            continue
        item_name = _normalize_poi_name(item.get("name"))
        if exclude_name and item_name == exclude_name:
            continue
        if is_excluded_guide_poi_name(item["name"], skip_keywords=skip_keywords):
            continue
        dist = item.get("distance_m")
        if dist is not None and dist > max(radius, GUIDE_MAX_DISTANCE_M):
            continue
        items.append(item)

    items = enrich_guide_items(
        dedupe_guide_items(items),
        user_id=user_id,
        campus=effective_campus,
        category=category,
    )
    try:
        total = int(result.get("count") or 0)
    except (TypeError, ValueError):
        total = len(items)
    has_more = page * page_size < total

    return {
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
        "has_more": has_more,
        "campus": effective_campus,
        "category": category,
        "keyword": keyword,
        "anchor_location": location,
    }


def fetch_ai_guide_seed(campus, category):
    """AI 候选不足时，拉取与 guide 排行榜相同的高德种子池。"""
    if category not in GUIDE_CATEGORY_CONFIG:
        category = "美食"
    return fetch_guide_category(campus, category)


def fetch_ai_dining_seed(campus, category):
    """兼容旧调用方。"""
    return fetch_ai_guide_seed(campus, category)


def invalidate_leaderboard_cache():
    _lb_response_cache.clear()


def build_leaderboard(campus, cat, random_order=False, user_id=None):
    if cat not in GUIDE_CATEGORY_CONFIG:
        return []

    if not random_order:
        cache_key = (campus, cat, user_id or 0)
        cached = _lb_response_cache.get(cache_key)
        if cached and time.time() - cached[0] < _LB_RESPONSE_CACHE_TTL_SEC:
            return cached[1]

    if campus == "all":
        sections = []
        for campus_name in GUIDE_CAMPUS_COORDS:
            sections.append({
                "campus": campus_name,
                "items": build_leaderboard(
                    campus_name, cat, random_order=random_order, user_id=user_id
                ),
            })
        result = sections
    elif campus not in GUIDE_CAMPUS_COORDS:
        result = _build_single_campus_leaderboard("鼓楼", cat, random_order, user_id)
    else:
        result = _build_single_campus_leaderboard(campus, cat, random_order, user_id)

    if not random_order:
        _lb_response_cache[(campus, cat, user_id or 0)] = (time.time(), result)
    return result


def _build_single_campus_leaderboard(campus, cat, random_order=False, user_id=None):
    db_items = fetch_db_leaderboard_candidates(campus, cat)
    if len(db_items) >= GUIDE_LEADERBOARD_LIMIT:
        return rank_leaderboard(
            db_items, random_order=random_order, user_id=user_id, campus=campus, category=cat,
        )

    seed = fetch_guide_category(campus, cat)
    merged = merge_leaderboard_candidates(seed, db_items)
    return rank_leaderboard(
        merged, random_order=random_order, user_id=user_id, campus=campus, category=cat,
    )


def _find_existing_guide_place(item, campus, guide_category):
    """按 poi_id 或 名称+校区+分类 查找已有 Place，避免重复入库导致赞数分裂。"""
    poi_id = (item.get("poi_id") or "").strip()
    if poi_id:
        existing = Place.query.filter_by(poi_id=poi_id).first()
        if existing:
            return existing

    name = (item.get("name") or "").strip()
    if not name:
        return None

    effective_campus = campus if campus not in ("", "all") else (item.get("campus") or "鼓楼")
    address = (item.get("address") or "").strip()
    q = Place.query.filter(
        Place.guide_category == guide_category,
        Place.name == name,
        Place.campus == effective_campus,
    )
    if address:
        q = q.filter(Place.address == address)
    return q.order_by(Place.id.asc()).first()


def place_from_guide_item(item, campus, guide_category, user_id=None):
    """将指南 POI 转为 Place 行（点赞前 ensure）。"""
    existing = _find_existing_guide_place(item, campus, guide_category)
    poi_id = (item.get("poi_id") or "").strip()
    photos = []
    if item.get("image"):
        photos = [item["image"]]
    cfg = GUIDE_CATEGORY_CONFIG.get(guide_category, {})
    payload = {
        "name": item.get("name") or "未命名",
        "address": item.get("address") or "",
        "location": item.get("location") or "",
        "poi_id": poi_id or None,
        "category": cfg.get("types", ""),
        "campus": campus if campus not in ("", "all") else (item.get("campus") or "鼓楼"),
        "guide_category": guide_category,
        "photos": json.dumps(photos, ensure_ascii=False) if photos else None,
    }
    if existing:
        for key, value in payload.items():
            if value is not None and value != "":
                setattr(existing, key, value)
        db.session.commit()
        return existing

    place = Place(added_by=user_id, **payload)
    db.session.add(place)
    db.session.commit()
    return place
