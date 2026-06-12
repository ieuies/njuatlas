from concurrent.futures import ThreadPoolExecutor, as_completed

from flask import Blueprint, current_app, jsonify, request

from app.errors import error_response
from app.logging_utils import log_event
from app.rate_limit import limiter
from app.services.amap import geocode, regeocode, search_places
from app.services.guide import (
    GUIDE_CAMPUS_COORDS,
    GUIDE_CATEGORY_CONFIG,
    fetch_guide_category,
    finalize_guide_items,
    guide_config_payload,
)
from app.validators import clean_string, int_range, validate_location


places_bp = Blueprint("places", __name__, url_prefix="/api/places")

HOT_AREAS = {
    "xinjiekou": {"name": "新街口", "location": "118.78472,32.03517"},
    "fuzimiao": {"name": "夫子庙", "location": "118.78811,32.02056"},
    "xianlin": {"name": "仙林大学城", "location": "118.93021,32.10247"},
    "jiangning": {"name": "江宁大学城", "location": "118.88359,31.93439"},
}


@places_bp.route("/hot_areas", methods=["GET"])
def get_hot_areas():
    return jsonify(HOT_AREAS)


@places_bp.route("/search", methods=["GET"])
@limiter.limit("240 per minute")
def search():
    """高德 POI 搜索。

    types 参数直接透传给高德 API，前端按高德官方 POI 分类编码传入即可。
    参见：https://lbs.amap.com/api/webservice/download （下载 POI 分类编码表）
    """
    keyword = clean_string(request.args.get("keyword"), "keyword", max_length=80)
    city = clean_string(request.args.get("city", "南京"), "city", max_length=50)
    location = clean_string(request.args.get("location"), "location", max_length=50)
    location = validate_location(location)
    page = int_range(request.args.get("page", 1), "page", min_value=1, max_value=50)
    page_size = int_range(request.args.get("page_size", 20), "page_size", min_value=1, max_value=25)
    radius = int_range(request.args.get("radius", 5000), "radius", min_value=100, max_value=50000)
    types = clean_string(request.args.get("types"), "types", max_length=100)
    sortrule = clean_string(request.args.get("sortrule"), "sortrule", max_length=20)

    result = search_places(keyword, city=city, location=location, page=page,
                           page_size=page_size, radius=radius, types=types, sortrule=sortrule)
    if result.get("status") != "1":
        return error_response("高德 API 调用失败", 502, code="amap_api_error")

    return jsonify(result)


@places_bp.route("/geocode", methods=["GET"])
@limiter.limit("30 per minute")
def geocode_route():
    """地址 → 坐标（地理编码）。"""
    address = clean_string(request.args.get("address"), "address", required=True, max_length=200)
    city = clean_string(request.args.get("city"), "city", max_length=50)

    result = geocode(address, city=city)
    if result.get("status") != "1":
        return error_response("高德地理编码失败", 502, code="amap_api_error")

    return jsonify(result)


@places_bp.route("/regeocode", methods=["GET"])
@limiter.limit("30 per minute")
def regeocode_route():
    """坐标 → 地址（逆地理编码）。"""
    location = clean_string(request.args.get("location"), "location", required=True, max_length=50)
    location = validate_location(location)

    result = regeocode(location)
    if result.get("status") != "1":
        return error_response("高德逆地理编码失败", 502, code="amap_api_error")

    return jsonify(result)


# ── 高德 POI "吃喝玩乐" 分类预设 ──────────────────────────────────
# 前端可用此数据构建分类筛选器，无需硬编码高德分类码。
# 每个分类项的 types 字段可直接传给 /api/places/search?types=xxx

CATEGORY_TREE = [
    {
        "key": "food",
        "label": "美食餐饮",
        "children": [
            {"key": "all_food",     "label": "全部美食",     "types": "050000"},
            {"key": "chinese",      "label": "中餐厅",       "types": "050100"},
            {"key": "foreign",      "label": "外国餐厅",     "types": "050200"},
            {"key": "fast_food",    "label": "快餐",         "types": "050300"},
            {"key": "cafe",         "label": "咖啡厅",       "types": "050500"},
            {"key": "tea",          "label": "茶艺馆",       "types": "050600"},
            {"key": "cold_drink",   "label": "饮品冷饮",     "types": "050700"},
            {"key": "dessert",      "label": "甜品烘焙",     "types": "050900"},
        ],
    },
    {
        "key": "shopping",
        "label": "购物逛街",
        "children": [
            {"key": "mall",         "label": "商场购物中心", "types": "060100"},
            {"key": "supermarket",  "label": "大型超市",     "types": "060400"},
            {"key": "street",       "label": "特色商业街",   "types": "061000"},
            {"key": "specialty",    "label": "品牌专卖店",   "types": "061200"},
        ],
    },
    {
        "key": "sports",
        "label": "运动健身",
        "children": [
            {"key": "all_sports",   "label": "全部运动场馆", "types": "080100"},
        ],
    },
    {
        "key": "entertainment",
        "label": "休闲娱乐",
        "children": [
            {"key": "all_entertainment", "label": "全部娱乐", "types": "080300"},
            {"key": "leisure",      "label": "度假休闲",     "types": "080500"},
            {"key": "cinema",       "label": "电影院剧院",   "types": "080600"},
        ],
    },
]


@places_bp.route("/guide-config", methods=["GET"])
def guide_config():
    """返回吃喝玩乐检索配置，供前端与 guide-bundle 保持一致。"""
    return jsonify(guide_config_payload())


def _fetch_guide_category_in_context(app, campus, cat, cfg):
    """ThreadPool worker：子线程内需 Flask app_context 才能访问 current_app（amap 缓存/配置）。"""
    with app.app_context():
        return fetch_guide_category(campus, cat, cfg)


@places_bp.route("/guide-category", methods=["GET"])
@limiter.limit("60 per minute")
def guide_category():
    """单分类 POI（服务端聚合多校区 + AMap 缓存），供吃喝玩乐懒加载。"""
    campus = clean_string(request.args.get("campus", "鼓楼"), "campus", max_length=20) or "鼓楼"
    category = clean_string(request.args.get("category"), "category", required=True, max_length=20)
    random_order = request.args.get("shuffle", "").lower() in ("1", "true", "yes")

    if category not in GUIDE_CATEGORY_CONFIG:
        return error_response("无效的分类", 400, code="invalid_category")

    cfg = GUIDE_CATEGORY_CONFIG[category]
    if campus == "all":
        campuses = list(GUIDE_CAMPUS_COORDS.keys())
    elif campus in GUIDE_CAMPUS_COORDS:
        campuses = [campus]
    else:
        campus = "鼓楼"
        campuses = [campus]

    raw = []
    app = current_app._get_current_object()
    max_workers = min(4, len(campuses))
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [
            pool.submit(_fetch_guide_category_in_context, app, c, category, cfg)
            for c in campuses
        ]
        for future in as_completed(futures):
            try:
                raw.extend(future.result() or [])
            except Exception as exc:
                log_event(
                    current_app.logger,
                    "guide_category_campus_failed",
                    level="warning",
                    category=category,
                    error=str(exc),
                )

    items = finalize_guide_items(raw, random_order=random_order)
    return jsonify({"campus": campus, "category": category, "items": items})


@places_bp.route("/guide-bundle", methods=["GET"])
@limiter.limit("30 per minute")
def guide_bundle():
    """一次性拉取吃喝玩乐六类 POI（服务端并行 + AMap 缓存 + Place enrichment）。"""
    campus = clean_string(request.args.get("campus", "鼓楼"), "campus", max_length=20) or "鼓楼"
    random_order = request.args.get("shuffle", "").lower() in ("1", "true", "yes")

    if campus == "all":
        campuses = list(GUIDE_CAMPUS_COORDS.keys())
    elif campus in GUIDE_CAMPUS_COORDS:
        campuses = [campus]
    else:
        campus = "鼓楼"
        campuses = [campus]

    raw_by_cat = {cat: [] for cat in GUIDE_CATEGORY_CONFIG}
    max_workers = min(24, len(campuses) * len(GUIDE_CATEGORY_CONFIG))
    app = current_app._get_current_object()
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [
            pool.submit(_fetch_guide_category_in_context, app, c, cat, cfg)
            for c in campuses
            for cat, cfg in GUIDE_CATEGORY_CONFIG.items()
        ]
        for future in as_completed(futures):
            try:
                items = future.result()
            except Exception as exc:
                log_event(
                    current_app.logger,
                    "guide_bundle_category_failed",
                    level="warning",
                    error=str(exc),
                )
                continue
            if items:
                raw_by_cat[items[0]["type"]].extend(items)

    categories = {
        cat: finalize_guide_items(raw_by_cat[cat], random_order=random_order)
        for cat in GUIDE_CATEGORY_CONFIG
    }

    return jsonify({"campus": campus, "categories": categories})


@places_bp.route("/categories", methods=["GET"])
def get_categories():
    """返回"吃喝玩乐"POI 分类预设，供前端筛选器使用。

    前端可将其渲染为分类选择器，选中某项后把 types 值传给 search 接口。
    """
    return jsonify({"categories": CATEGORY_TREE})
