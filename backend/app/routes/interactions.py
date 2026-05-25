from flask import Blueprint, current_app, g, jsonify, request

from app import db
from app.auth_utils import jwt_required
from app.errors import error_response
from app.logging_utils import log_event
from app.models import Favorite, Like, Restaurant, Review
from app.rate_limit import limiter
from app.validators import (
    clean_string,
    get_json_body,
    optional_rating,
    positive_int,
    validate_location,
)


inter_bp = Blueprint("interactions", __name__, url_prefix="/api")


@inter_bp.route("/restaurant", methods=["POST"])
@jwt_required
@limiter.limit("30 per minute")
def add_restaurant():
    data = get_json_body(request)
    name = clean_string(data.get("name"), "name", required=True, max_length=100)
    address = clean_string(data.get("address"), "address", max_length=200) or ""
    location = clean_string(data.get("location"), "location", max_length=50) or ""
    location = validate_location(location)
    poi_id = clean_string(data.get("poi_id"), "poi_id", max_length=100)

    if poi_id:
        existing = Restaurant.query.filter_by(poi_id=poi_id).first()
        if existing:
            log_event(
                current_app.logger,
                "restaurant_duplicate",
                user_id=g.current_user_id,
                restaurant_id=existing.id,
                poi_id=poi_id,
            )
            return jsonify({"id": existing.id, "name": existing.name, "message": "餐厅已存在"}), 200

    restaurant = Restaurant(
        name=name,
        address=address,
        location=location,
        poi_id=poi_id,
        added_by=g.current_user_id,
    )
    db.session.add(restaurant)
    db.session.commit()
    log_event(
        current_app.logger,
        "restaurant_created",
        user_id=g.current_user_id,
        restaurant_id=restaurant.id,
        poi_id=poi_id,
    )
    return jsonify({"id": restaurant.id, "name": restaurant.name}), 201


@inter_bp.route("/review", methods=["POST"])
@jwt_required
@limiter.limit("30 per minute")
def add_review():
    data = get_json_body(request)
    restaurant_id = positive_int(data.get("restaurant_id"), "restaurant_id")
    content = clean_string(data.get("content"), "content", required=True, max_length=500)
    rating = optional_rating(data.get("rating"))

    restaurant = Restaurant.query.get(restaurant_id)
    if not restaurant:
        return error_response("餐厅不存在", 404, code="restaurant_not_found")

    review = Review(
        content=content,
        rating=rating,
        user_id=g.current_user_id,
        restaurant_id=restaurant_id,
    )
    db.session.add(review)
    db.session.commit()
    log_event(
        current_app.logger,
        "review_created",
        user_id=g.current_user_id,
        restaurant_id=restaurant_id,
        review_id=review.id,
        rating=rating,
    )
    return jsonify({"id": review.id, "content": review.content}), 201


@inter_bp.route("/like", methods=["POST"])
@jwt_required
@limiter.limit("60 per minute")
def toggle_like():
    data = get_json_body(request)
    restaurant_id = positive_int(data.get("restaurant_id"), "restaurant_id")

    if not Restaurant.query.get(restaurant_id):
        return error_response("餐厅不存在", 404, code="restaurant_not_found")

    existing = Like.query.filter_by(user_id=g.current_user_id, restaurant_id=restaurant_id).first()
    if existing:
        db.session.delete(existing)
        db.session.commit()
        log_event(current_app.logger, "like_removed", user_id=g.current_user_id, restaurant_id=restaurant_id)
        return jsonify({"liked": False, "message": "已取消点赞"})

    like = Like(user_id=g.current_user_id, restaurant_id=restaurant_id)
    db.session.add(like)
    db.session.commit()
    log_event(current_app.logger, "like_added", user_id=g.current_user_id, restaurant_id=restaurant_id)
    return jsonify({"liked": True, "message": "点赞成功"})


@inter_bp.route("/favorite", methods=["POST"])
@jwt_required
@limiter.limit("60 per minute")
def toggle_favorite():
    data = get_json_body(request)
    restaurant_id = positive_int(data.get("restaurant_id"), "restaurant_id")

    if not Restaurant.query.get(restaurant_id):
        return error_response("餐厅不存在", 404, code="restaurant_not_found")

    existing = Favorite.query.filter_by(user_id=g.current_user_id, restaurant_id=restaurant_id).first()
    if existing:
        db.session.delete(existing)
        db.session.commit()
        log_event(current_app.logger, "favorite_removed", user_id=g.current_user_id, restaurant_id=restaurant_id)
        return jsonify({"favorited": False, "message": "已取消收藏"})

    fav = Favorite(user_id=g.current_user_id, restaurant_id=restaurant_id)
    db.session.add(fav)
    db.session.commit()
    log_event(current_app.logger, "favorite_added", user_id=g.current_user_id, restaurant_id=restaurant_id)
    return jsonify({"favorited": True, "message": "收藏成功"})


@inter_bp.route("/restaurant/<int:restaurant_id>/stats", methods=["GET"])
def restaurant_stats(restaurant_id):
    restaurant = Restaurant.query.get(restaurant_id)
    if not restaurant:
        return error_response("餐厅不存在", 404, code="restaurant_not_found")

    likes_count = Like.query.filter_by(restaurant_id=restaurant_id).count()
    favs_count = Favorite.query.filter_by(restaurant_id=restaurant_id).count()
    reviews = Review.query.filter_by(restaurant_id=restaurant_id).order_by(Review.created_at.desc()).all()

    return jsonify({
        "restaurant_id": restaurant_id,
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
