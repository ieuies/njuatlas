from flask import Blueprint, jsonify, request

from app.errors import error_response
from app.rate_limit import limiter
from app.services.amap import search_places
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
    keyword = clean_string(request.args.get("keyword"), "keyword", required=True, max_length=80)
    city = clean_string(request.args.get("city", "南京"), "city", max_length=50)
    location = clean_string(request.args.get("location"), "location", max_length=50)
    location = validate_location(location)
    page = int_range(request.args.get("page", 1), "page", min_value=1, max_value=50)
    page_size = int_range(request.args.get("page_size", 20), "page_size", min_value=1, max_value=25)
    radius = int_range(request.args.get("radius", 5000), "radius", min_value=100, max_value=50000)

    result = search_places(keyword, city=city, location=location, page=page, page_size=page_size, radius=radius)
    if result.get("status") != "1":
        return error_response("高德 API 调用失败", 502, code="amap_api_error")

    return jsonify(result)
