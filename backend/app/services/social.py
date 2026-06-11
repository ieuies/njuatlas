"""社交层业务逻辑：好友、私信、通知、公开用户资料。"""
import json
from sqlalchemy import func, or_

from app import db
from app.models import (
    DirectMessage,
    EventPost,
    Friendship,
    Notification,
    PostLike,
    User,
)


def _dt(value):
    return value.isoformat() if value else None


def public_user_brief(user):
    """公开可见的用户摘要（不含 email）。"""
    tags = []
    if user.tags:
        try:
            tags = json.loads(user.tags)
        except (json.JSONDecodeError, TypeError):
            tags = []
    return {
        "id": user.id,
        "username": user.username,
        "bio": user.bio or "",
        "campus": user.campus or "",
        "tags": tags,
        "avatar_url": user.avatar_url or "",
        "cover_url": user.cover_url or "",
        "bubble_style": user.bubble_style or "atlas-classic",
        "created_at": _dt(user.created_at),
    }


def count_user_posts(user_id):
    return EventPost.query.filter_by(user_id=user_id).count()


def count_likes_received(user_id):
    return (
        db.session.query(func.coalesce(func.sum(EventPost.like_count), 0))
        .filter(EventPost.user_id == user_id)
        .scalar()
        or 0
    )


def count_friends(user_id):
    return Friendship.query.filter(
        Friendship.status == "accepted",
        or_(
            Friendship.requester_id == user_id,
            Friendship.addressee_id == user_id,
        ),
    ).count()


def get_friendship_between(user_a, user_b):
    """查找两用户之间的好友记录（任意方向）。"""
    if user_a == user_b:
        return None
    return Friendship.query.filter(
        or_(
            (Friendship.requester_id == user_a) & (Friendship.addressee_id == user_b),
            (Friendship.requester_id == user_b) & (Friendship.addressee_id == user_a),
        )
    ).first()


def are_friends(user_a, user_b):
    row = get_friendship_between(user_a, user_b)
    return row is not None and row.status == "accepted"


def friendship_status_for(viewer_id, target_id):
    """从 viewer 视角看与 target 的关系：none / pending_sent / pending_received / friends。"""
    if viewer_id == target_id:
        return "self"
    row = get_friendship_between(viewer_id, target_id)
    if not row:
        return "none"
    if row.status == "accepted":
        return "friends"
    if row.status == "pending":
        if row.requester_id == viewer_id:
            return "pending_sent"
        return "pending_received"
    return "none"


def list_friend_ids(user_id):
    rows = Friendship.query.filter(
        Friendship.status == "accepted",
        or_(
            Friendship.requester_id == user_id,
            Friendship.addressee_id == user_id,
        ),
    ).all()
    ids = []
    for row in rows:
        ids.append(row.addressee_id if row.requester_id == user_id else row.requester_id)
    return ids


def create_notification(*, user_id, actor_id, ntype, post_id=None, friendship_id=None):
    """写入通知（不给自己发）。"""
    if user_id == actor_id:
        return None
    note = Notification(
        user_id=user_id,
        actor_id=actor_id,
        type=ntype,
        post_id=post_id,
        friendship_id=friendship_id,
    )
    db.session.add(note)
    return note


def clear_friend_request_notifications(friendship_id):
    """好友请求已处理/撤回时，移除对应的 friend_request 通知。"""
    if not friendship_id:
        return 0
    return Notification.query.filter_by(
        type="friend_request",
        friendship_id=friendship_id,
    ).delete(synchronize_session=False)


def friend_request_notification_status(friendship_id):
    """返回好友请求通知关联的关系状态；无记录时返回 None。"""
    if not friendship_id:
        return None
    row = Friendship.query.get(friendship_id)
    if not row:
        return "gone"
    return row.status


def should_show_notification(note):
    """已处理的好友请求通知不再出现在互动列表。"""
    if note.type != "friend_request" or not note.friendship_id:
        return True
    status = friend_request_notification_status(note.friendship_id)
    return status == "pending"


def notification_payload(note):
    actor = note.actor
    data = {
        "id": note.id,
        "type": note.type,
        "is_read": note.is_read,
        "created_at": _dt(note.created_at),
        "actor": public_user_brief(actor) if actor else None,
        "post_id": note.post_id,
        "friendship_id": note.friendship_id,
    }
    if note.post:
        data["post_title"] = note.post.title
    if note.type == "friend_request" and note.friendship_id:
        data["friendship_status"] = friend_request_notification_status(note.friendship_id)
    return data


def unread_notification_count(user_id):
    return Notification.query.filter_by(user_id=user_id, is_read=False).count()


def unread_dm_count(user_id):
    return DirectMessage.query.filter_by(receiver_id=user_id, is_read=False).count()


def conversation_summaries(user_id):
    """按对方用户聚合最近一条私信。"""
    msgs = (
        DirectMessage.query.filter(
            or_(DirectMessage.sender_id == user_id, DirectMessage.receiver_id == user_id)
        )
        .order_by(DirectMessage.created_at.desc())
        .all()
    )
    seen = {}
    for msg in msgs:
        peer_id = msg.receiver_id if msg.sender_id == user_id else msg.sender_id
        if peer_id in seen:
            continue
        peer = User.query.get(peer_id)
        unread = DirectMessage.query.filter_by(
            sender_id=peer_id, receiver_id=user_id, is_read=False
        ).count()
        seen[peer_id] = {
            "peer_id": peer_id,
            "peer": public_user_brief(peer) if peer else {"id": peer_id, "username": "用户"},
            "last_message": msg.content,
            "last_at": _dt(msg.created_at),
            "unread_count": unread,
        }
    return list(seen.values())
