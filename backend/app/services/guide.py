"""吃喝玩乐 guide 页：共享配置、POI 转换、Place  enrichment 与排序。"""

import random

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

GUIDE_SEARCH_RADIUS = 20000
GUIDE_PAGE_SIZE = 10
GUIDE_SORT_RULE = "weight"

GUIDE_CATEGORY_CONFIG = {
    "美食": {"types": "050000", "keyword": "", "max_pages": 2},
    "咖啡饮品": {"types": "050500|050600|050700|050900", "keyword": "", "max_pages": 2},
    "休闲娱乐": {"types": "080300|080600", "keyword": "", "max_pages": 2},
    "运动健身": {"types": "080100", "keyword": "", "max_pages": 2},
    "购物商圈": {"types": "060100|061000", "keyword": "", "max_pages": 2},
    "景点公园": {
        "types": "110000|140100|140200|140300|140400|140500",
        "keyword": "",
        "max_pages": 3,
    },
}


def guide_search_city(campus):
    return "苏州" if campus == "苏州" else "南京"


def guide_config_payload():
    """供 /api/places/guide-config 与前端共用的配置快照。"""
    return {
        "campuses": GUIDE_CAMPUS_COORDS,
        "categories": GUIDE_CATEGORY_CONFIG,
        "search_radius": GUIDE_SEARCH_RADIUS,
        "page_size": GUIDE_PAGE_SIZE,
        "sortrule": GUIDE_SORT_RULE,
    }


GUIDE_EXCLUDED_NAME_KEYWORDS = (
    "南京大学",
    "南大",
    "酒店",
    "政府部门",
    "商学院",
)


def _normalize_poi_name(name):
    return (name or "").strip().replace("（", "(").replace("）", ")")


def is_excluded_guide_poi_name(name):
    """排除名称含指定关键词的 POI（仅看名称，不看地址）。"""
    normalized = _normalize_poi_name(name)
    if not normalized:
        return False
    return any(keyword in normalized for keyword in GUIDE_EXCLUDED_NAME_KEYWORDS)


def filter_guide_items(items):
    return [item for item in items if not is_excluded_guide_poi_name(item.get("name"))]


def _poi_to_item(poi, cat, campus):
    biz = poi.get("biz_ext") or {}
    cost = biz.get("cost")
    return {
        "poi_id": str(poi.get("id") or "").strip(),
        "name": poi.get("name") or "",
        "desc": poi.get("address") or "",
        "image": (poi.get("photos") or [{}])[0].get("url", "") if poi.get("photos") else "",
        "type": cat,
        "campus": campus,
        "rating": biz.get("rating", "") or "",
        "price": f"¥{cost}/人" if cost else "",
        "address": poi.get("address") or "",
        "location": poi.get("location") or "",
    }


def fetch_guide_category(campus, cat, cfg=None):
    """拉取单校区单分类 POI 列表（高德 weight 排序）。"""
    cfg = cfg or GUIDE_CATEGORY_CONFIG[cat]
    location = GUIDE_CAMPUS_COORDS.get(campus, GUIDE_CAMPUS_COORDS["鼓楼"])
    city = guide_search_city(campus)
    max_pages = cfg.get("max_pages", 2)
    target_count = max_pages * GUIDE_PAGE_SIZE
    max_attempts = max_pages + 2

    items = []
    seen = set()
    page = 1
    while page <= max_attempts and len(items) < target_count:
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
            item = _poi_to_item(poi, cat, campus)
            if is_excluded_guide_poi_name(item["name"]):
                continue
            key = _dedupe_key(item)
            if key in seen:
                continue
            seen.add(key)
            items.append(item)
            if len(items) >= target_count:
                break
        if page >= max_pages and len(items) >= GUIDE_PAGE_SIZE:
            break
        page += 1
    return items


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
    """高德评分与站内评分取较高者作为展示/排序依据。"""
    amap_rating = _parse_rating(item.get("rating"))
    platform_rating = _parse_rating(item.get("platform_rating"))
    if platform_rating and amap_rating:
        return max(amap_rating, platform_rating)
    return platform_rating or amap_rating


def sort_score(item):
    """综合排序分：评分权重 + 站内互动热度。"""
    heat = (item.get("like_count") or 0) * 2 + (item.get("review_count") or 0)
    return effective_rating(item) * 10 + heat


def sort_guide_items(items, random_order=False):
    items = list(items)
    if random_order:
        random.shuffle(items)
        return items
    items.sort(key=sort_score, reverse=True)
    return items


def enrich_guide_items(items):
    """用 Place 表补充站内评分、点赞与评论数。"""
    if not items:
        return items

    poi_ids = [item["poi_id"] for item in items if item.get("poi_id")]
    places_by_poi = {}
    if poi_ids:
        for place in Place.query.filter(Place.poi_id.in_(poi_ids)).all():
            places_by_poi[place.poi_id] = place

    place_ids = [place.id for place in places_by_poi.values()]
    like_counts = {}
    review_counts = {}
    review_avg = {}
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

    enriched = []
    for item in items:
        row = dict(item)
        place = places_by_poi.get(row.get("poi_id") or "")
        like_count = 0
        review_count = 0
        platform_rating = None
        if place:
            like_count = like_counts.get(place.id, 0)
            review_count = review_counts.get(place.id, 0)
            if place.avg_rating is not None:
                platform_rating = round(float(place.avg_rating), 1)
            elif place.id in review_avg:
                platform_rating = review_avg[place.id]
            row["place_id"] = place.id

        row["like_count"] = like_count
        row["review_count"] = review_count
        if platform_rating is not None:
            row["platform_rating"] = platform_rating
            display = effective_rating(row)
            if display:
                row["rating"] = str(display)
        row["sort_score"] = sort_score(row)
        enriched.append(row)
    return enriched


def finalize_guide_items(items, random_order=False):
    """去重 → 过滤校名 POI → 站内 enrichment → 统一排序。"""
    items = dedupe_guide_items(items)
    items = filter_guide_items(items)
    items = enrich_guide_items(items)
    return sort_guide_items(items, random_order=random_order)
