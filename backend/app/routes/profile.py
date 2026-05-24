from flask import Blueprint, g, jsonify

from app.auth_utils import jwt_required
from app.models import ConversationMessage, Favorite, Like, Review
from app.rate_limit import limiter


profile_bp = Blueprint("profile", __name__, url_prefix="/api/me")


def _dt(value):
    return value.isoformat() if value else None


def _restaurant_payload(restaurant):
    if not restaurant:
        return None
    return {
        "id": restaurant.id,
        "name": restaurant.name,
        "address": restaurant.address,
        "location": restaurant.location,
        "poi_id": restaurant.poi_id,
    }


@profile_bp.route("/favorites", methods=["GET"])
@jwt_required
@limiter.limit("60 per minute")
def my_favorites():
    rows = (
        Favorite.query
        .filter_by(user_id=g.current_user_id)
        .order_by(Favorite.created_at.desc())
        .all()
    )
    return jsonify({
        "items": [
            {
                "id": row.id,
                "created_at": _dt(row.created_at),
                "restaurant": _restaurant_payload(row.restaurant),
            }
            for row in rows
        ]
    })


@profile_bp.route("/likes", methods=["GET"])
@jwt_required
@limiter.limit("60 per minute")
def my_likes():
    rows = (
        Like.query
        .filter_by(user_id=g.current_user_id)
        .order_by(Like.created_at.desc())
        .all()
    )
    return jsonify({
        "items": [
            {
                "id": row.id,
                "created_at": _dt(row.created_at),
                "restaurant": _restaurant_payload(row.restaurant),
            }
            for row in rows
        ]
    })


@profile_bp.route("/reviews", methods=["GET"])
@jwt_required
@limiter.limit("60 per minute")
def my_reviews():
    rows = (
        Review.query
        .filter_by(user_id=g.current_user_id)
        .order_by(Review.created_at.desc())
        .all()
    )
    return jsonify({
        "items": [
            {
                "id": row.id,
                "content": row.content,
                "rating": row.rating,
                "created_at": _dt(row.created_at),
                "restaurant": _restaurant_payload(row.restaurant),
            }
            for row in rows
        ]
    })


@profile_bp.route("/conversations", methods=["GET"])
@jwt_required
@limiter.limit("60 per minute")
def my_conversations():
    messages = (
        ConversationMessage.query
        .filter_by(user_id=g.current_user_id)
        .order_by(ConversationMessage.created_at.desc(), ConversationMessage.id.desc())
        .all()
    )

    sessions = {}
    for message in messages:
        session = sessions.setdefault(
            message.session_id,
            {
                "session_id": message.session_id,
                "last_message": None,
                "last_role": None,
                "last_at": None,
                "message_count": 0,
            },
        )
        session["message_count"] += 1
        if session["last_at"] is None:
            session["last_message"] = message.content
            session["last_role"] = message.role
            session["last_at"] = _dt(message.created_at)

    return jsonify({"items": list(sessions.values())})
