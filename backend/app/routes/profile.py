from flask import Blueprint, current_app, g, jsonify, request
import re

from sqlalchemy import func
from sqlalchemy.orm import joinedload, selectinload

from app import db
from app.auth_utils import jwt_required
from app.errors import error_response
from app.logging_utils import log_event
from app.models import ConversationMessage, EventParticipant, EventPost, Favorite, Like, PostFavorite, PostTag, Review
from app.services.note import SingleNote
from app.rate_limit import limiter
from app.services.social import count_friends, count_likes_received, count_user_posts, user_avatar_url, user_cover_url
from app.validators import clean_string, get_json_body


profile_bp = Blueprint("profile", __name__, url_prefix="/api/me")
BUBBLE_STYLE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,49}$")
ALLOWED_BUBBLE_STYLES = {
    "nailong-style-1",
    "atlas-classic",
    "atlas-ocean",
    "atlas-sunset",
    "atlas-ink",
}


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


def _post_payload(post):
    if not post:
        return None
    return {
        "id": post.id,
        "title": post.title,
        "content": post.content,
        "type": post.type,
        "favorite_count": post.favorite_count or 0,
        "created_at": _dt(post.created_at),
    }


@profile_bp.route("/activities", methods=["GET"])
@jwt_required
@limiter.limit("60 per minute")
def my_activities():
    """当前用户报名参加的组局/活动（按报名时间倒序）。"""
    rows = (
        EventParticipant.query
        .filter_by(user_id=g.current_user_id, status="going")
        .order_by(EventParticipant.created_at.desc())
        .limit(50)
        .all()
    )
    if not rows:
        return jsonify({"items": []})

    post_ids = [row.post_id for row in rows]
    posts = (
        EventPost.query
        .options(selectinload(EventPost.user))
        .filter(EventPost.id.in_(post_ids))
        .all()
    )
    posts_map = {post.id: post for post in posts}

    tags_map = {}
    tag_rows = (
        PostTag.query
        .options(joinedload(PostTag.tag))
        .filter(PostTag.post_id.in_(post_ids))
        .all()
    )
    for row in tag_rows:
        if row.tag:
            tags_map.setdefault(row.post_id, []).append(row.tag.name)

    user_id = g.current_user_id
    items = []
    for row in rows:
        post = posts_map.get(row.post_id)
        if not post:
            continue
        note = SingleNote(model=post)
        items.append(note.to_dict(
            current_user_id=user_id,
            brief=True,
            _tags=tags_map.get(post.id, []),
            _participation=row.status,
        ))
    return jsonify({"items": items})


@profile_bp.route("/favorites", methods=["GET"])
@jwt_required
@limiter.limit("60 per minute")
def my_favorites():
    place_rows = (
        Favorite.query
        .options(joinedload(Favorite.place))
        .filter_by(user_id=g.current_user_id)
        .order_by(Favorite.created_at.desc())
        .all()
    )
    post_rows = (
        PostFavorite.query
        .options(joinedload(PostFavorite.post))
        .filter_by(user_id=g.current_user_id)
        .order_by(PostFavorite.created_at.desc())
        .all()
    )
    items = [
        {
            "id": row.id,
            "kind": "place",
            "created_at": _dt(row.created_at),
            "place": _place_payload(row.place),
        }
        for row in place_rows
    ] + [
        {
            "id": row.id,
            "kind": "post",
            "created_at": _dt(row.created_at),
            "post": _post_payload(row.post),
        }
        for row in post_rows
        if row.post is not None
    ]
    items.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return jsonify({
        "items": items
    })


@profile_bp.route("/likes", methods=["GET"])
@jwt_required
@limiter.limit("60 per minute")
def my_likes():
    rows = (
        Like.query
        .options(joinedload(Like.place))
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
        .options(joinedload(Review.place))
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
    """按会话聚合最近一条消息；避免窗口函数，SQLite 下更稳更快。"""
    user_id = g.current_user_id
    latest_sub = (
        db.session.query(
            ConversationMessage.session_id.label("session_id"),
            func.max(ConversationMessage.id).label("max_id"),
        )
        .filter(ConversationMessage.user_id == user_id)
        .group_by(ConversationMessage.session_id)
        .subquery()
    )
    rows = (
        db.session.query(ConversationMessage)
        .join(latest_sub, ConversationMessage.id == latest_sub.c.max_id)
        .order_by(ConversationMessage.created_at.desc(), ConversationMessage.id.desc())
        .all()
    )
    if not rows:
        return jsonify({"items": []})

    session_ids = [row.session_id for row in rows]
    counts = dict(
        db.session.query(
            ConversationMessage.session_id,
            func.count(ConversationMessage.id),
        )
        .filter(
            ConversationMessage.user_id == user_id,
            ConversationMessage.session_id.in_(session_ids),
        )
        .group_by(ConversationMessage.session_id)
        .all()
    )
    return jsonify({
        "items": [
            {
                "session_id": row.session_id,
                "last_message": row.content,
                "last_role": row.role,
                "last_at": _dt(row.created_at),
                "message_count": counts.get(row.session_id, 0),
            }
            for row in rows
        ]
    })


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
        "campus": user.campus or "",
        "tags": tags,
        "avatar_url": user_avatar_url(user),
        "cover_url": user_cover_url(user),
        "bubble_style": user.bubble_style or "atlas-classic",
        "created_at": _dt(user.created_at),
        "updated_at": _dt(user.updated_at),
    }


@profile_bp.route("/profile", methods=["GET"])
@jwt_required
@limiter.limit("60 per minute")
def get_profile():
    """获取当前登录用户的个人资料。"""
    user_id = g.current_user_id
    data = _profile_payload(g.current_user)
    data["post_count"] = count_user_posts(user_id)
    data["friend_count"] = count_friends(user_id)
    data["like_received_count"] = count_likes_received(user_id)
    return jsonify(data)


@profile_bp.route("/profile", methods=["PUT"])
@jwt_required
@limiter.limit("30 per minute")
def update_profile():
    """修改个人资料（username、bio、campus、tags、bubble_style）。"""
    import json
    data = get_json_body(request)

    campus = clean_string(data.get("campus"), "campus", max_length=20)
    if campus and campus not in ("鼓楼", "仙林", "浦口", "苏州"):
        return error_response("campus 必须是 鼓楼/仙林/浦口/苏州 之一", 400, code="invalid_campus")
    username = clean_string(data.get("username"), "username", max_length=50)
    bio = clean_string(data.get("bio"), "bio", max_length=300)
    tags_raw = data.get("tags")
    bubble_style = clean_string(data.get("bubble_style"), "bubble_style", max_length=50)
    if bubble_style is not None:
        bubble_style = bubble_style or "atlas-classic"
        if not BUBBLE_STYLE_RE.match(bubble_style):
            return error_response("bubble_style 格式不合法", 400, code="invalid_bubble_style")
        if bubble_style not in ALLOWED_BUBBLE_STYLES:
            return error_response("bubble_style 不在可选范围内", 400, code="unsupported_bubble_style")

    user = g.current_user

    if username and username != user.username:
        from app.models import User
        if User.query.filter_by(username=username).first():
            return error_response("用户名已被使用", 409, code="username_exists")
        user.username = username

    if bio is not None:
        user.bio = bio

    if campus is not None:
        user.campus = campus

    if tags_raw is not None:
        if not isinstance(tags_raw, list):
            return error_response("tags 必须是数组", 400, code="invalid_tags")
        if len(tags_raw) > 20:
            return error_response("标签最多 20 个", 400, code="too_many_tags")
        for t in tags_raw:
            if not isinstance(t, str) or len(t) > 20:
                return error_response("每个标签最长 20 个字符", 400, code="invalid_tag")
        user.tags = json.dumps(tags_raw, ensure_ascii=False)

    if bubble_style is not None:
        user.bubble_style = bubble_style

    db.session.commit()
    log_event(
        current_app.logger,
        "profile_updated",
        user_id=user.id,
    )
    return jsonify(_profile_payload(user))
