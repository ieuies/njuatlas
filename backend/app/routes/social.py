"""社交 API：公开用户资料、好友、私信、通知。"""
import base64
import os
import re
import uuid

from flask import Blueprint, current_app, g, jsonify, request, send_from_directory
from sqlalchemy import or_

from app import db
from app.auth_utils import jwt_required
from app.errors import error_response
from app.models import DirectMessage, Friendship, Notification, User
from app.rate_limit import limiter
from app.services.social import (
    are_friends,
    clear_friend_request_notifications,
    conversation_summaries,
    count_friends,
    count_likes_received,
    count_user_posts,
    create_notification,
    friendship_status_for,
    get_friendship_between,
    list_friend_ids,
    notification_payload,
    should_show_notification,
    public_user_brief,
    unread_dm_count,
    unread_notification_count,
)
from app.validators import clean_string, get_json_body

social_bp = Blueprint("social", __name__, url_prefix="/api/social")


def _dt(value):
    return value.isoformat() if value else None


def _avatar_dir():
    basedir = os.path.abspath(os.path.dirname(__file__))
    path = os.path.join(basedir, "..", "..", "uploads", "avatars")
    os.makedirs(path, exist_ok=True)
    return path


def _cover_dir():
    basedir = os.path.abspath(os.path.dirname(__file__))
    path = os.path.join(basedir, "..", "..", "uploads", "covers")
    os.makedirs(path, exist_ok=True)
    return path


# ── 公开用户资料 ──────────────────────────────────────────────

@social_bp.route("/users/search", methods=["GET"])
@jwt_required
@limiter.limit("60 per minute")
def search_users():
    q = (request.args.get("q") or "").strip()
    if len(q) < 1:
        return jsonify({"items": []})
    rows = (
        User.query.filter(User.username.ilike(f"%{q}%"))
        .filter(User.id != g.current_user_id)
        .limit(20)
        .all()
    )
    items = []
    for u in rows:
        brief = public_user_brief(u)
        relation = get_friendship_between(g.current_user_id, u.id)
        status = "none"
        if relation:
            if relation.status == "accepted":
                status = "friends"
            elif relation.status == "pending":
                status = (
                    "pending_sent"
                    if relation.requester_id == g.current_user_id
                    else "pending_received"
                )
                brief["friendship_request_id"] = relation.id
        brief["friendship_status"] = status
        items.append(brief)
    return jsonify({"items": items})


@social_bp.route("/users/<int:user_id>", methods=["GET"])
@jwt_required
@limiter.limit("120 per minute")
def get_user_profile(user_id):
    user = User.query.get(user_id)
    if not user:
        return error_response("用户不存在", 404, code="user_not_found")
    data = public_user_brief(user)
    data["post_count"] = count_user_posts(user_id)
    data["friend_count"] = count_friends(user_id)
    data["like_received_count"] = count_likes_received(user_id)
    data["friendship_status"] = friendship_status_for(g.current_user_id, user_id)
    return jsonify(data)


# ── 好友 ──────────────────────────────────────────────────────

@social_bp.route("/friends", methods=["GET"])
@jwt_required
@limiter.limit("60 per minute")
def list_friends():
    ids = list_friend_ids(g.current_user_id)
    users = User.query.filter(User.id.in_(ids)).all() if ids else []
    return jsonify({
        "items": [public_user_brief(u) for u in users],
    })


@social_bp.route("/friends/requests", methods=["GET"])
@jwt_required
@limiter.limit("60 per minute")
def list_friend_requests():
    rows = Friendship.query.filter_by(addressee_id=g.current_user_id, status="pending").all()
    return jsonify({
        "items": [
            {
                "id": row.id,
                "requester": public_user_brief(row.requester),
                "created_at": _dt(row.created_at),
            }
            for row in rows
        ],
    })


@social_bp.route("/friends/requests/sent", methods=["GET"])
@jwt_required
@limiter.limit("60 per minute")
def list_sent_friend_requests():
    rows = Friendship.query.filter_by(requester_id=g.current_user_id, status="pending").all()
    return jsonify({
        "items": [
            {
                "id": row.id,
                "addressee": public_user_brief(row.addressee),
                "created_at": _dt(row.created_at),
            }
            for row in rows
        ],
    })


@social_bp.route("/friends/request", methods=["POST"])
@jwt_required
@limiter.limit("30 per minute")
def send_friend_request():
    data = get_json_body(request)
    target_id = data.get("user_id")
    if not target_id:
        return error_response("需要 user_id", 400, code="missing_user_id")
    target_id = int(target_id)
    if target_id == g.current_user_id:
        return error_response("不能加自己为好友", 400, code="self_friend")

    target = User.query.get(target_id)
    if not target:
        return error_response("用户不存在", 404, code="user_not_found")

    existing = get_friendship_between(g.current_user_id, target_id)
    if existing:
        if existing.status == "accepted":
            return error_response("已经是好友", 400, code="already_friends")
        if existing.status == "pending":
            return error_response("好友请求已存在", 400, code="request_exists")
        existing.status = "pending"
        existing.requester_id = g.current_user_id
        existing.addressee_id = target_id
        db.session.commit()
        create_notification(
            user_id=target_id,
            actor_id=g.current_user_id,
            ntype="friend_request",
            friendship_id=existing.id,
        )
        db.session.commit()
        return jsonify({"id": existing.id, "status": "pending"})

    row = Friendship(
        requester_id=g.current_user_id,
        addressee_id=target_id,
        status="pending",
    )
    db.session.add(row)
    db.session.flush()
    create_notification(
        user_id=target_id,
        actor_id=g.current_user_id,
        ntype="friend_request",
        friendship_id=row.id,
    )
    db.session.commit()
    return jsonify({"id": row.id, "status": "pending"}), 201


@social_bp.route("/friends/requests/<int:request_id>/accept", methods=["POST"])
@jwt_required
@limiter.limit("30 per minute")
def accept_friend_request(request_id):
    row = Friendship.query.get(request_id)
    if not row or row.addressee_id != g.current_user_id or row.status != "pending":
        return error_response("请求不存在或已处理", 404, code="request_not_found")
    row.status = "accepted"
    clear_friend_request_notifications(row.id)
    create_notification(
        user_id=row.requester_id,
        actor_id=g.current_user_id,
        ntype="friend_accept",
        friendship_id=row.id,
    )
    db.session.commit()
    return jsonify({"status": "accepted"})


@social_bp.route("/friends/requests/<int:request_id>/reject", methods=["POST"])
@jwt_required
@limiter.limit("30 per minute")
def reject_friend_request(request_id):
    row = Friendship.query.get(request_id)
    if not row or row.addressee_id != g.current_user_id or row.status != "pending":
        return error_response("请求不存在或已处理", 404, code="request_not_found")
    row.status = "rejected"
    clear_friend_request_notifications(row.id)
    db.session.commit()
    return jsonify({"status": "rejected"})


@social_bp.route("/friends/requests/<int:request_id>/cancel", methods=["POST"])
@jwt_required
@limiter.limit("30 per minute")
def cancel_friend_request(request_id):
    row = Friendship.query.get(request_id)
    if not row or row.requester_id != g.current_user_id or row.status != "pending":
        return error_response("请求不存在或已处理", 404, code="request_not_found")
    row.status = "cancelled"
    clear_friend_request_notifications(row.id)
    db.session.commit()
    return jsonify({"status": "cancelled"})


@social_bp.route("/friends/<int:user_id>", methods=["DELETE"])
@jwt_required
@limiter.limit("30 per minute")
def remove_friend(user_id):
    row = get_friendship_between(g.current_user_id, user_id)
    if not row or row.status != "accepted":
        return error_response("不是好友关系", 404, code="not_friends")
    db.session.delete(row)
    db.session.commit()
    return jsonify({"ok": True})


# ── 私信 ──────────────────────────────────────────────────────

@social_bp.route("/messages/conversations", methods=["GET"])
@jwt_required
@limiter.limit("60 per minute")
def list_conversations():
    return jsonify({"items": conversation_summaries(g.current_user_id)})


@social_bp.route("/messages/<int:peer_id>", methods=["GET"])
@jwt_required
@limiter.limit("120 per minute")
def get_messages(peer_id):
    if not are_friends(g.current_user_id, peer_id):
        return error_response("只能与好友私信", 403, code="not_friends")
    page = max(1, int(request.args.get("page", 1)))
    page_size = min(100, max(1, int(request.args.get("page_size", 50))))
    q = DirectMessage.query.filter(
        or_(
            (DirectMessage.sender_id == g.current_user_id) & (DirectMessage.receiver_id == peer_id),
            (DirectMessage.sender_id == peer_id) & (DirectMessage.receiver_id == g.current_user_id),
        )
    ).order_by(DirectMessage.created_at.asc())
    total = q.count()
    rows = q.offset((page - 1) * page_size).limit(page_size).all()
    DirectMessage.query.filter_by(
        sender_id=peer_id, receiver_id=g.current_user_id, is_read=False
    ).update({"is_read": True})
    db.session.commit()
    return jsonify({
        "items": [
            {
                "id": m.id,
                "sender_id": m.sender_id,
                "receiver_id": m.receiver_id,
                "content": m.content,
                "is_read": m.is_read,
                "created_at": _dt(m.created_at),
                "is_mine": m.sender_id == g.current_user_id,
            }
            for m in rows
        ],
        "page": page,
        "page_size": page_size,
        "total": total,
    })


@social_bp.route("/messages/<int:peer_id>", methods=["POST"])
@jwt_required
@limiter.limit("60 per minute")
def send_message(peer_id):
    if not are_friends(g.current_user_id, peer_id):
        return error_response("只能与好友私信", 403, code="not_friends")
    data = get_json_body(request)
    content = clean_string(data.get("content"), "content", max_length=1000)
    if not content:
        return error_response("消息不能为空", 400, code="empty_message")
    msg = DirectMessage(
        sender_id=g.current_user_id,
        receiver_id=peer_id,
        content=content,
    )
    db.session.add(msg)
    db.session.commit()
    return jsonify({
        "id": msg.id,
        "sender_id": msg.sender_id,
        "receiver_id": msg.receiver_id,
        "content": msg.content,
        "created_at": _dt(msg.created_at),
        "is_mine": True,
    }), 201


# ── 通知 ──────────────────────────────────────────────────────

@social_bp.route("/notifications", methods=["GET"])
@jwt_required
@limiter.limit("60 per minute")
def list_notifications():
    page = max(1, int(request.args.get("page", 1)))
    page_size = min(50, max(1, int(request.args.get("page_size", 30))))
    q = Notification.query.filter_by(user_id=g.current_user_id).order_by(
        Notification.created_at.desc()
    )
    total = q.count()
    rows = q.offset((page - 1) * page_size).limit(page_size).all()
    visible = [n for n in rows if should_show_notification(n)]
    return jsonify({
        "items": [notification_payload(n) for n in visible],
        "page": page,
        "page_size": page_size,
        "total": total,
    })


@social_bp.route("/notifications/unread", methods=["GET"])
@jwt_required
@limiter.limit("120 per minute")
def unread_counts():
    return jsonify({
        "notifications": unread_notification_count(g.current_user_id),
        "messages": unread_dm_count(g.current_user_id),
        "total": unread_notification_count(g.current_user_id) + unread_dm_count(g.current_user_id),
    })


@social_bp.route("/notifications/read", methods=["POST"])
@jwt_required
@limiter.limit("60 per minute")
def mark_notifications_read():
    data = get_json_body(request) or {}
    ids = data.get("ids")
    if ids:
        Notification.query.filter(
            Notification.user_id == g.current_user_id,
            Notification.id.in_(ids),
        ).update({"is_read": True}, synchronize_session=False)
    else:
        Notification.query.filter_by(user_id=g.current_user_id, is_read=False).update(
            {"is_read": True}, synchronize_session=False
        )
    db.session.commit()
    return jsonify({"ok": True})


# ── 头像/封面上传与静态访问 ───────────────────────────────────

_DATA_URL_RE = re.compile(r"^data:image/(jpeg|jpg|png|webp);base64,", re.I)


@social_bp.route("/avatars/<path:filename>", methods=["GET"])
@limiter.limit("300 per minute")
def serve_avatar(filename):
    return send_from_directory(_avatar_dir(), filename)


@social_bp.route("/covers/<path:filename>", methods=["GET"])
@limiter.limit("300 per minute")
def serve_cover(filename):
    return send_from_directory(_cover_dir(), filename)


@social_bp.route("/me/avatar", methods=["POST"])
@jwt_required
@limiter.limit("20 per minute")
def upload_avatar():
    data = get_json_body(request)
    raw = data.get("avatar") or data.get("data_url") or ""
    if not isinstance(raw, str) or not raw.startswith("data:image"):
        return error_response("需要 base64 图片 data URL", 400, code="invalid_avatar")
    m = _DATA_URL_RE.match(raw)
    if not m:
        return error_response("仅支持 JPEG/PNG/WebP", 400, code="invalid_format")
    ext = "jpg" if m.group(1).lower() in ("jpeg", "jpg") else m.group(1).lower()
    b64 = raw.split(",", 1)[1]
    try:
        binary = base64.b64decode(b64)
    except Exception:
        return error_response("图片解码失败", 400, code="decode_failed")
    if len(binary) > 2 * 1024 * 1024:
        return error_response("图片不能超过 2MB", 400, code="too_large")

    filename = f"user_{g.current_user_id}_{uuid.uuid4().hex[:12]}.{ext}"
    filepath = os.path.join(_avatar_dir(), filename)
    with open(filepath, "wb") as f:
        f.write(binary)

    user = g.current_user
    user.avatar_url = f"/api/social/avatars/{filename}"
    db.session.commit()
    return jsonify({"avatar_url": user.avatar_url})


@social_bp.route("/me/cover", methods=["POST"])
@jwt_required
@limiter.limit("20 per minute")
def upload_cover():
    data = get_json_body(request)
    raw = data.get("cover") or data.get("data_url") or ""
    if not isinstance(raw, str) or not raw.startswith("data:image"):
        return error_response("需要 base64 图片 data URL", 400, code="invalid_cover")
    m = _DATA_URL_RE.match(raw)
    if not m:
        return error_response("仅支持 JPEG/PNG/WebP", 400, code="invalid_format")
    ext = "jpg" if m.group(1).lower() in ("jpeg", "jpg") else m.group(1).lower()
    b64 = raw.split(",", 1)[1]
    try:
        binary = base64.b64decode(b64)
    except Exception:
        return error_response("图片解码失败", 400, code="decode_failed")
    if len(binary) > 5 * 1024 * 1024:
        return error_response("封面图片不能超过 5MB", 400, code="too_large")

    filename = f"user_{g.current_user_id}_{uuid.uuid4().hex[:12]}.{ext}"
    filepath = os.path.join(_cover_dir(), filename)
    with open(filepath, "wb") as f:
        f.write(binary)

    user = g.current_user
    user.cover_url = f"/api/social/covers/{filename}"
    db.session.commit()
    return jsonify({"cover_url": user.cover_url})
