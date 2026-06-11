"""社交 API：公开用户资料、好友、私信、通知。"""
import base64
import os
import re
import time

from flask import Blueprint, current_app, g, jsonify, request, Response, send_from_directory
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
    dm_tail_messages,
    dm_thread_message_count,
    count_friends,
    count_likes_received,
    count_user_posts,
    create_notification,
    friendship_status_for,
    friendship_status_map,
    friendship_statuses_by_ids,
    get_friendship_between,
    list_friend_ids,
    notification_payload,
    should_show_notification,
    public_user_brief,
    unread_counts as fetch_unread_counts,
    unread_dm_count,
    unread_notification_count,
    user_avatar_url,
    user_cover_url,
)
from app.validators import clean_string, get_json_body

social_bp = Blueprint("social", __name__, url_prefix="/api/social")


def _dt(value):
    return value.isoformat() if value else None


def _upload_root():
    """本地开发用 backend/uploads；线上 Render 应挂载持久盘并设置 UPLOAD_ROOT。"""
    custom = os.environ.get("UPLOAD_ROOT")
    if custom:
        root = os.path.abspath(custom)
    else:
        basedir = os.path.abspath(os.path.dirname(__file__))
        root = os.path.join(basedir, "..", "..", "uploads")
    os.makedirs(root, exist_ok=True)
    return root


def _avatar_dir():
    path = os.path.join(_upload_root(), "avatars")
    os.makedirs(path, exist_ok=True)
    return path


def _cover_dir():
    path = os.path.join(_upload_root(), "covers")
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
    candidate_ids = [u.id for u in rows]
    relation_map = friendship_status_map(g.current_user_id, candidate_ids)
    items = []
    for u in rows:
        brief = public_user_brief(u)
        status, relation = relation_map.get(u.id, ("none", None))
        if relation and relation.status == "pending":
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

def _dm_item_dict(m, current_user_id):
    return {
        "id": m.id,
        "sender_id": m.sender_id,
        "receiver_id": m.receiver_id,
        "content": m.content,
        "is_read": m.is_read,
        "created_at": _dt(m.created_at),
        "is_mine": m.sender_id == current_user_id,
    }


def _dm_thread_query(current_user_id, peer_id):
    return DirectMessage.query.filter(
        or_(
            (DirectMessage.sender_id == current_user_id) & (DirectMessage.receiver_id == peer_id),
            (DirectMessage.sender_id == peer_id) & (DirectMessage.receiver_id == current_user_id),
        )
    )


def _dm_rows_after(base_q, peer_id, current_user_id, after_id):
    return (
        base_q.filter(DirectMessage.id > after_id)
        .order_by(DirectMessage.created_at.asc())
        .limit(100)
        .all()
    )


def _dm_sync_after(base_q, peer_id, current_user_id, after_id):
    rows = _dm_rows_after(base_q, peer_id, current_user_id, after_id)
    if rows:
        DirectMessage.query.filter_by(
            sender_id=peer_id, receiver_id=current_user_id, is_read=False
        ).update({"is_read": True})
        db.session.commit()
    return rows


def _dm_wait_for_new(base_q, peer_id, current_user_id, after_id, wait_sec):
    """长轮询：最多 wait_sec 秒，每 ~350ms 查一次新消息（零额外服务成本）。"""
    poll_interval = 0.35
    deadline = time.monotonic() + wait_sec
    rows = _dm_sync_after(base_q, peer_id, current_user_id, after_id)
    while not rows and time.monotonic() < deadline:
        time.sleep(poll_interval)
        db.session.expire_all()
        rows = _dm_sync_after(base_q, peer_id, current_user_id, after_id)
    return rows


@social_bp.route("/messages/conversations", methods=["GET"])
@jwt_required
@limiter.limit("60 per minute")
def list_conversations():
    return jsonify({"items": conversation_summaries(g.current_user_id)})


@social_bp.route("/messages/<int:peer_id>", methods=["GET"])
@jwt_required
@limiter.limit("180 per minute")
def get_messages(peer_id):
    if not are_friends(g.current_user_id, peer_id):
        return error_response("只能与好友私信", 403, code="not_friends")
    page_size = min(100, max(1, int(request.args.get("page_size", 50))))
    tail = request.args.get("tail") == "1"
    base_q = _dm_thread_query(g.current_user_id, peer_id)
    after_raw = request.args.get("after_id")
    if after_raw is not None and after_raw != "":
        after_id = max(0, int(after_raw))
        wait_sec = 0
        wait_raw = request.args.get("wait")
        if wait_raw is not None and wait_raw != "":
            try:
                wait_sec = min(25, max(0, int(wait_raw)))
            except (TypeError, ValueError):
                wait_sec = 0
        if wait_sec > 0:
            rows = _dm_wait_for_new(base_q, peer_id, g.current_user_id, after_id, wait_sec)
        else:
            rows = _dm_sync_after(base_q, peer_id, g.current_user_id, after_id)
        return jsonify({
            "items": [_dm_item_dict(m, g.current_user_id) for m in rows],
            "sync": True,
        })

    DirectMessage.query.filter_by(
        sender_id=peer_id, receiver_id=g.current_user_id, is_read=False
    ).update({"is_read": True})

    if tail:
        rows = dm_tail_messages(g.current_user_id, peer_id, page_size)
        total = dm_thread_message_count(g.current_user_id, peer_id)
        page = max(1, (total + page_size - 1) // page_size) if total else 1
    else:
        page = max(1, int(request.args.get("page", 1)))
        total = dm_thread_message_count(g.current_user_id, peer_id)
        rows = (
            base_q.order_by(DirectMessage.created_at.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )

    db.session.commit()
    peer_user = User.query.get(peer_id)
    return jsonify({
        "peer": public_user_brief(peer_user) if peer_user else {"id": peer_id, "username": "用户"},
        "items": [_dm_item_dict(m, g.current_user_id) for m in rows],
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
    friendship_ids = [
        n.friendship_id for n in rows if n.type == "friend_request" and n.friendship_id
    ]
    friendship_status_cache = friendship_statuses_by_ids(friendship_ids)
    visible = [n for n in rows if should_show_notification(n, friendship_status_cache)]
    return jsonify({
        "items": [notification_payload(n, friendship_status_cache) for n in visible],
        "page": page,
        "page_size": page_size,
        "total": total,
    })


@social_bp.route("/notifications/unread", methods=["GET"])
@jwt_required
@limiter.limit("120 per minute")
def unread_counts():
    data = fetch_unread_counts(g.current_user_id)
    return jsonify(data)


@social_bp.route("/notifications/read", methods=["POST"])
@jwt_required
@limiter.limit("60 per minute")
def mark_notifications_read():
    data = get_json_body(request) or {}
    ids = data.get("ids")
    exclude_types = data.get("exclude_types") or []
    if ids:
        Notification.query.filter(
            Notification.user_id == g.current_user_id,
            Notification.id.in_(ids),
        ).update({"is_read": True}, synchronize_session=False)
    elif exclude_types:
        Notification.query.filter(
            Notification.user_id == g.current_user_id,
            Notification.is_read.is_(False),
            Notification.type.notin_(exclude_types),
        ).update({"is_read": True}, synchronize_session=False)
    else:
        Notification.query.filter_by(user_id=g.current_user_id, is_read=False).update(
            {"is_read": True}, synchronize_session=False
        )
    db.session.commit()
    return jsonify({"ok": True})


# ── 头像/封面上传与静态访问 ───────────────────────────────────

_DATA_URL_RE = re.compile(r"^data:image/(jpeg|jpg|png|webp);base64,", re.I)
_AVATAR_FNAME_RE = re.compile(r"^user_(\d+)(?:_[\w-]+)?\.(jpg|jpeg|png|webp)$", re.I)
_COVER_FNAME_RE = _AVATAR_FNAME_RE


def _image_mime(ext):
    ext = (ext or "jpg").lower()
    if ext in ("jpg", "jpeg"):
        return "image/jpeg"
    return f"image/{ext}"


def _avatar_mime(ext):
    return _image_mime(ext)


def _user_id_from_image_filename(filename, pattern=_AVATAR_FNAME_RE):
    m = pattern.match(os.path.basename(filename or ""))
    return int(m.group(1)) if m else None


def _mime_from_image_filename(filename, pattern=_AVATAR_FNAME_RE):
    m = pattern.match(os.path.basename(filename or ""))
    return _image_mime(m.group(2) if m else "jpg")


def _user_id_from_avatar_filename(filename):
    return _user_id_from_image_filename(filename, _AVATAR_FNAME_RE)


def _mime_from_avatar_filename(filename):
    return _mime_from_image_filename(filename, _AVATAR_FNAME_RE)


def _user_id_from_cover_filename(filename):
    return _user_id_from_image_filename(filename, _COVER_FNAME_RE)


def _mime_from_cover_filename(filename):
    return _mime_from_image_filename(filename, _COVER_FNAME_RE)


def _as_image_bytes(blob):
    if blob is None:
        return None
    if isinstance(blob, memoryview):
        return blob.tobytes()
    if isinstance(blob, (bytes, bytearray)):
        return bytes(blob)
    return bytes(blob)


def _image_response(blob, mime):
    data = _as_image_bytes(blob)
    if not data:
        return None
    return Response(
        data,
        mimetype=mime or "image/jpeg",
        headers={"Cache-Control": "public, max-age=300"},
    )


def _serve_user_image_by_id(user, data_attr, url_attr, image_dir, not_found_code="image_not_found", mime_default="image/jpeg"):
    if not user:
        return error_response("图片不存在", 404, code=not_found_code)
    blob = getattr(user, data_attr, None)
    if blob:
        mime_attr = data_attr.replace("_data", "_mime")
        mime = getattr(user, mime_attr, None) or mime_default
        resp = _image_response(blob, mime)
        if resp:
            return resp
    legacy_url = getattr(user, url_attr, None) or ""
    if legacy_url:
        safe_name = os.path.basename(legacy_url)
        filepath = os.path.join(image_dir, safe_name)
        if os.path.isfile(filepath):
            return send_from_directory(image_dir, safe_name)
    return error_response("图片不存在", 404, code=not_found_code)


def _serve_user_image(filename, image_dir, user_id_fn, mime_fn, data_attr, not_found_code):
    safe_name = os.path.basename(filename)
    uid = user_id_fn(safe_name)
    if uid:
        user = User.query.get(uid)
        blob = getattr(user, data_attr, None) if user else None
        if blob:
            mime_attr = data_attr.replace("_data", "_mime")
            mime = getattr(user, mime_attr, None) or mime_fn(safe_name)
            resp = _image_response(blob, mime)
            if resp:
                return resp

    filepath = os.path.join(image_dir, safe_name)
    if os.path.isfile(filepath):
        return send_from_directory(image_dir, safe_name)

    user = User.query.filter(
        or_(
            User.avatar_url.like(f"%/{safe_name}"),
            User.cover_url.like(f"%/{safe_name}"),
        )
    ).first()
    if user:
        blob = getattr(user, data_attr, None)
        if blob:
            mime_attr = data_attr.replace("_data", "_mime")
            mime = getattr(user, mime_attr, None) or mime_fn(safe_name)
            resp = _image_response(blob, mime)
            if resp:
                return resp

    return error_response("图片不存在", 404, code=not_found_code)


@social_bp.route("/users/<int:user_id>/avatar", methods=["GET"])
@limiter.limit("300 per minute")
def serve_user_avatar_by_id(user_id):
    user = User.query.get(user_id)
    return _serve_user_image_by_id(user, "avatar_data", "avatar_url", _avatar_dir(), "avatar_not_found")


@social_bp.route("/users/<int:user_id>/cover", methods=["GET"])
@limiter.limit("300 per minute")
def serve_user_cover_by_id(user_id):
    user = User.query.get(user_id)
    return _serve_user_image_by_id(user, "cover_data", "cover_url", _cover_dir(), "cover_not_found")


@social_bp.route("/avatars/<path:filename>", methods=["GET"])
@limiter.limit("300 per minute")
def serve_avatar(filename):
    return _serve_user_image(
        filename, _avatar_dir(), _user_id_from_avatar_filename,
        _mime_from_avatar_filename, "avatar_data", "avatar_not_found",
    )


@social_bp.route("/covers/<path:filename>", methods=["GET"])
@limiter.limit("300 per minute")
def serve_cover(filename):
    return _serve_user_image(
        filename, _cover_dir(), _user_id_from_cover_filename,
        _mime_from_cover_filename, "cover_data", "cover_not_found",
    )


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

    user = g.current_user
    filename = f"user_{g.current_user_id}.{ext}"
    mime = _avatar_mime(ext)

    user.avatar_data = binary
    user.avatar_mime = mime
    user.avatar_url = f"/api/social/users/{g.current_user_id}/avatar"

    filepath = os.path.join(_avatar_dir(), filename)
    try:
        with open(filepath, "wb") as f:
            f.write(binary)
    except OSError:
        pass

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

    user = g.current_user
    filename = f"user_{g.current_user_id}.{ext}"
    mime = _image_mime(ext)

    user.cover_data = binary
    user.cover_mime = mime
    user.cover_url = f"/api/social/users/{g.current_user_id}/cover"

    filepath = os.path.join(_cover_dir(), filename)
    try:
        with open(filepath, "wb") as f:
            f.write(binary)
    except OSError:
        pass

    db.session.commit()
    return jsonify({"cover_url": user.cover_url})
