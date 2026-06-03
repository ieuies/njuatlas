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
    keyword = clean_string(request.args.get("keyword"), "keyword", required=True, max_length=80)
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
