from flask import Blueprint, current_app, g, jsonify, request

from app import db
from app.auth_utils import jwt_required
from app.errors import error_response
from app.logging_utils import log_event
from app.models import ConversationMessage, Favorite, Like, Review
from app.rate_limit import limiter
from app.validators import clean_string, get_json_body


profile_bp = Blueprint("profile", __name__, url_prefix="/api/me")


def _dt(value):
    return value.isoformat() if value else None


def _place_payload(place):
    if not place:
        return None
    return {
        "id": place.id,
        "name": place.name,
        "address": place.address,
        "location": place.location,
        "poi_id": place.poi_id,
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
                "place": _place_payload(row.place),
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
                "place": _place_payload(row.place),
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
                "place": _place_payload(row.place),
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


def _profile_payload(user):
    """返回当前用户的完整 profile。"""
    import json
    tags = []
    if user.tags:
        try:
            tags = json.loads(user.tags)
        except (json.JSONDecodeError, TypeError):
            tags = []
    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "email_verified": bool(user.email_verified),
        "bio": user.bio or "",
        "tags": tags,
        "avatar_url": user.avatar_url or "",
        "created_at": _dt(user.created_at),
        "updated_at": _dt(user.updated_at),
    }


@profile_bp.route("/profile", methods=["GET"])
@jwt_required
@limiter.limit("60 per minute")
def get_profile():
    """获取当前登录用户的个人资料。"""
    return jsonify(_profile_payload(g.current_user))


@profile_bp.route("/profile", methods=["PUT"])
@jwt_required
@limiter.limit("30 per minute")
def update_profile():
    """修改个人资料（username、bio、tags）。"""
    import json
    data = get_json_body(request)

    username = clean_string(data.get("username"), "username", max_length=50)
    bio = clean_string(data.get("bio"), "bio", max_length=300)
    tags_raw = data.get("tags")

    user = g.current_user

    if username and username != user.username:
        from app.models import User
        if User.query.filter_by(username=username).first():
            return error_response("用户名已被使用", 409, code="username_exists")
        user.username = username

    if bio is not None:
        user.bio = bio

    if tags_raw is not None:
        if not isinstance(tags_raw, list):
            return error_response("tags 必须是数组", 400, code="invalid_tags")
        if len(tags_raw) > 20:
            return error_response("标签最多 20 个", 400, code="too_many_tags")
        for t in tags_raw:
            if not isinstance(t, str) or len(t) > 20:
                return error_response("每个标签最长 20 个字符", 400, code="invalid_tag")
        user.tags = json.dumps(tags_raw, ensure_ascii=False)

    db.session.commit()
    log_event(
        current_app.logger,
        "profile_updated",
        user_id=user.id,
    )
    return jsonify(_profile_payload(user))
