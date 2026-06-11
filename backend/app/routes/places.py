from concurrent.futures import ThreadPoolExecutor, as_completed

from flask import Blueprint, jsonify, request

from app.errors import error_response
from app.rate_limit import limiter
from app.services.amap import geocode, regeocode, search_places
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


GUIDE_CAMPUS_COORDS = {
    "鼓楼": "118.780,32.058",
    "仙林": "118.954,32.114",
    "浦口": "118.652,32.157",
    "苏州": "120.39,31.36",
}
GUIDE_CATEGORY_CONFIG = {
    "美食": {"types": "050000", "keyword": "", "max_pages": 2},
    "咖啡饮品": {"types": "050500|050600|050700|050900", "keyword": "", "max_pages": 2},
    "休闲娱乐": {"types": "080300|080600", "keyword": "", "max_pages": 2},
    "运动健身": {"types": "080100", "keyword": "", "max_pages": 2},
    "购物商圈": {"types": "060100|061000", "keyword": "", "max_pages": 2},
    "景点公园": {"types": "110000|140100|140200|140300|140400|140500", "keyword": "", "max_pages": 3},
}


def _guide_search_city(campus):
    return "苏州" if campus == "苏州" else "南京"


def _fetch_guide_category(campus, cat, cfg):
    location = GUIDE_CAMPUS_COORDS.get(campus, GUIDE_CAMPUS_COORDS["鼓楼"])
    city = _guide_search_city(campus)
    pois = []
    for page in range(1, cfg["max_pages"] + 1):
        result = search_places(
            cfg["keyword"],
            city=city,
            location=location,
            page=page,
            page_size=10,
            radius=20000,
            types=cfg["types"],
            sortrule="weight",
        )
        if result.get("status") != "1":
            break
        batch = result.get("pois") or []
        if not batch:
            break
        pois.extend(batch)
    items = []
    for poi in pois:
        items.append({
            "name": poi.get("name"),
            "desc": poi.get("address") or "",
            "image": (poi.get("photos") or [{}])[0].get("url", "") if poi.get("photos") else "",
            "type": cat,
            "campus": campus,
            "rating": (poi.get("biz_ext") or {}).get("rating", ""),
            "price": (
                f"¥{(poi.get('biz_ext') or {}).get('cost')}/人"
                if (poi.get("biz_ext") or {}).get("cost")
                else ""
            ),
            "address": poi.get("address") or "",
        })
    return cat, items


@places_bp.route("/guide-bundle", methods=["GET"])
@limiter.limit("30 per minute")
def guide_bundle():
    """一次性拉取吃喝玩乐六类 POI（服务端并行 + AMap 缓存）。"""
    campus = clean_string(request.args.get("campus", "鼓楼"), "campus", max_length=20) or "鼓楼"
    if campus not in GUIDE_CAMPUS_COORDS:
        campus = "鼓楼"

    categories = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {
            pool.submit(_fetch_guide_category, campus, cat, cfg): cat
            for cat, cfg in GUIDE_CATEGORY_CONFIG.items()
        }
        for future in as_completed(futures):
            cat, items = future.result()
            categories[cat] = items

    return jsonify({"campus": campus, "categories": categories})


@places_bp.route("/categories", methods=["GET"])
def get_categories():
    """返回"吃喝玩乐"POI 分类预设，供前端筛选器使用。

    前端可将其渲染为分类选择器，选中某项后把 types 值传给 search 接口。
    """
    return jsonify({"categories": CATEGORY_TREE})
