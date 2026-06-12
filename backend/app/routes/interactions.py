from flask import Blueprint, current_app, g, jsonify, request

from app import db
from app.auth_utils import jwt_required
from app.errors import error_response
from app.logging_utils import log_event
from app.models import Favorite, Like, Place, Review
from app.rate_limit import limiter
from app.validators import (
    clean_string,
    get_json_body,
    optional_rating,
    positive_int,
    validate_location,
)


inter_bp = Blueprint("interactions", __name__, url_prefix="/api")


@inter_bp.route("/place", methods=["POST"])
@jwt_required
@limiter.limit("30 per minute")
def add_place():
    data = get_json_body(request)
    name = clean_string(data.get("name"), "name", required=True, max_length=100)
    address = clean_string(data.get("address"), "address", max_length=200) or ""
    location = clean_string(data.get("location"), "location", max_length=50) or ""
    location = validate_location(location)
    poi_id = clean_string(data.get("poi_id"), "poi_id", max_length=100)
    category = clean_string(data.get("category"), "category", max_length=50)

    if poi_id:
        existing = Place.query.filter_by(poi_id=poi_id).first()
        if existing:
            log_event(
                current_app.logger,
                "place_duplicate",
                user_id=g.current_user_id,
                place_id=existing.id,
                poi_id=poi_id,
            )
            return jsonify({"id": existing.id, "name": existing.name, "message": "场所已存在"}), 200

    place = Place(
        name=name,
        address=address,
        location=location,
        poi_id=poi_id,
        category=category,
        added_by=g.current_user_id,
    )
    db.session.add(place)
    db.session.commit()
    log_event(
        current_app.logger,
        "place_created",
        user_id=g.current_user_id,
        place_id=place.id,
        poi_id=poi_id,
    )
    return jsonify({"id": place.id, "name": place.name}), 201


@inter_bp.route("/review", methods=["POST"])
@jwt_required
@limiter.limit("30 per minute")
def add_review():
    data = get_json_body(request)
    place_id = positive_int(data.get("place_id"), "place_id")
    content = clean_string(data.get("content"), "content", required=True, max_length=500)
    rating = optional_rating(data.get("rating"))

    place = Place.query.get(place_id)
    if not place:
        return error_response("场所不存在", 404, code="place_not_found")

    review = Review(
        content=content,
        rating=rating,
        user_id=g.current_user_id,
        place_id=place_id,
    )
    db.session.add(review)
    db.session.commit()
    log_event(
        current_app.logger,
        "review_created",
        user_id=g.current_user_id,
        place_id=place_id,
        review_id=review.id,
        rating=rating,
    )
    return jsonify({"id": review.id, "content": review.content}), 201


@inter_bp.route("/like", methods=["POST"])
@jwt_required
@limiter.limit("60 per minute")
def toggle_like():
    data = get_json_body(request)
    place_id = positive_int(data.get("place_id"), "place_id")

    place = Place.query.get(place_id)
    if not place:
        return error_response("场所不存在", 404, code="place_not_found")
    existing = Like.query.filter_by(user_id=g.current_user_id, place_id=place_id).first()
    if existing:
        db.session.delete(existing)
        db.session.commit()
        from app.services.guide_rank_cache import sync_place_rank

        sync_place_rank(place)
        log_event(current_app.logger, "like_removed", user_id=g.current_user_id, place_id=place_id)
        return jsonify({"liked": False, "message": "已取消点赞"})

    like = Like(user_id=g.current_user_id, place_id=place_id)
    db.session.add(like)
    db.session.commit()
    from app.services.guide_rank_cache import sync_place_rank

    sync_place_rank(place)
    log_event(current_app.logger, "like_added", user_id=g.current_user_id, place_id=place_id)
    return jsonify({"liked": True, "message": "点赞成功"})


@inter_bp.route("/favorite", methods=["POST"])
@jwt_required
@limiter.limit("60 per minute")
def toggle_favorite():
    data = get_json_body(request)
    place_id = positive_int(data.get("place_id"), "place_id")

    if not Place.query.get(place_id):
        return error_response("场所不存在", 404, code="place_not_found")

    existing = Favorite.query.filter_by(user_id=g.current_user_id, place_id=place_id).first()
    if existing:
        db.session.delete(existing)
        db.session.commit()
        log_event(current_app.logger, "favorite_removed", user_id=g.current_user_id, place_id=place_id)
        return jsonify({"favorited": False, "message": "已取消收藏"})

    fav = Favorite(user_id=g.current_user_id, place_id=place_id)
    db.session.add(fav)
    db.session.commit()
    log_event(current_app.logger, "favorite_added", user_id=g.current_user_id, place_id=place_id)
    return jsonify({"favorited": True, "message": "收藏成功"})


@inter_bp.route("/place/<int:place_id>/stats", methods=["GET"])
def place_stats(place_id):
    place = Place.query.get(place_id)
    if not place:
        return error_response("场所不存在", 404, code="place_not_found")

    likes_count = Like.query.filter_by(place_id=place_id).count()
    favs_count = Favorite.query.filter_by(place_id=place_id).count()
    reviews = Review.query.filter_by(place_id=place_id).order_by(Review.created_at.desc()).all()

    return jsonify({
        "place_id": place_id,
        "likes": likes_count,
        "favorites": favs_count,
        "reviews": [
            {
                "id": r.id,
                "content": r.content,
                "rating": r.rating,
                "user_id": r.user_id,
                "created_at": r.created_at,
            }
            for r in reviews
        ],
    })
