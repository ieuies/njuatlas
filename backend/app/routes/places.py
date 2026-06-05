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
@limiter.limit("30 per minute")
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

    result = search_places(keyword, city=city, location=location, page=page,
                           page_size=page_size, radius=radius, types=types)
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


@places_bp.route("/categories", methods=["GET"])
def get_categories():
    """返回"吃喝玩乐"POI 分类预设，供前端筛选器使用。

    前端可将其渲染为分类选择器，选中某项后把 types 值传给 search 接口。
    """
    return jsonify({"categories": CATEGORY_TREE})
