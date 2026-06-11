"""社交层业务逻辑：好友、私信、通知、公开用户资料。"""
import json
from sqlalchemy import and_, case, func, or_

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


def friendship_status_map(viewer_id, target_ids):
    """批量查询 viewer 与多个 target 的好友关系。返回 target_id -> (status, row|None)。"""
    if not target_ids:
        return {}
    unique_ids = list(set(target_ids))
    rows = Friendship.query.filter(
        or_(
            and_(Friendship.requester_id == viewer_id, Friendship.addressee_id.in_(unique_ids)),
            and_(Friendship.addressee_id == viewer_id, Friendship.requester_id.in_(unique_ids)),
        )
    ).all()
    result = {}
    for row in rows:
        other_id = row.addressee_id if row.requester_id == viewer_id else row.requester_id
        if other_id not in unique_ids:
            continue
        if row.status == "accepted":
            result[other_id] = ("friends", row)
        elif row.status == "pending":
            status = "pending_sent" if row.requester_id == viewer_id else "pending_received"
            result[other_id] = (status, row)
        else:
            result[other_id] = ("none", row)
    return result


def friendship_statuses_by_ids(friendship_ids):
    """批量返回 friendship_id -> status。"""
    if not friendship_ids:
        return {}
    rows = Friendship.query.filter(Friendship.id.in_(friendship_ids)).all()
    return {row.id: row.status for row in rows}


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


def should_show_notification(note, friendship_status_cache=None):
    """已处理的好友请求通知不再出现在互动列表。"""
    if note.type != "friend_request" or not note.friendship_id:
        return True
    if friendship_status_cache is not None:
        status = friendship_status_cache.get(note.friendship_id)
        if status is None:
            status = "gone"
    else:
        status = friend_request_notification_status(note.friendship_id)
    return status == "pending"


def notification_payload(note, friendship_status_cache=None):
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
        if friendship_status_cache is not None:
            data["friendship_status"] = friendship_status_cache.get(note.friendship_id, "gone")
        else:
            data["friendship_status"] = friend_request_notification_status(note.friendship_id)
    return data


def unread_notification_count(user_id):
    return Notification.query.filter_by(user_id=user_id, is_read=False).count()


def unread_dm_count(user_id):
    return DirectMessage.query.filter_by(receiver_id=user_id, is_read=False).count()


def conversation_summaries(user_id):
    """按对方用户聚合最近一条私信（固定次数 SQL，不随历史消息总量增长）。"""
    peer_col = case(
        (DirectMessage.sender_id == user_id, DirectMessage.receiver_id),
        else_=DirectMessage.sender_id,
    )

    ranked_subq = (
        db.session.query(
            DirectMessage.content.label("content"),
            DirectMessage.created_at.label("created_at"),
            DirectMessage.sender_id.label("sender_id"),
            DirectMessage.receiver_id.label("receiver_id"),
            peer_col.label("peer_id"),
            func.row_number()
            .over(partition_by=peer_col, order_by=DirectMessage.created_at.desc())
            .label("rn"),
        )
        .filter(
            or_(
                DirectMessage.sender_id == user_id,
                DirectMessage.receiver_id == user_id,
            )
        )
        .subquery()
    )

    latest_rows = (
        db.session.query(ranked_subq)
        .filter(ranked_subq.c.rn == 1)
        .all()
    )

    unread_rows = (
        db.session.query(
            DirectMessage.sender_id,
            func.count(DirectMessage.id),
        )
        .filter_by(receiver_id=user_id, is_read=False)
        .group_by(DirectMessage.sender_id)
        .all()
    )
    unread_map = {sender_id: count for sender_id, count in unread_rows}

    friend_ids = set(list_friend_ids(user_id))
    peer_ids = {row.peer_id for row in latest_rows if row.peer_id in friend_ids}
    users = User.query.filter(User.id.in_(peer_ids)).all() if peer_ids else []
    user_map = {u.id: u for u in users}

    summaries = []
    for row in latest_rows:
        if row.peer_id not in friend_ids:
            continue
        peer = user_map.get(row.peer_id)
        summaries.append({
            "peer_id": row.peer_id,
            "peer": public_user_brief(peer) if peer else {"id": row.peer_id, "username": "用户"},
            "last_message": row.content,
            "last_at": _dt(row.created_at),
            "unread_count": unread_map.get(row.peer_id, 0),
        })

    summaries.sort(key=lambda item: item["last_at"] or "", reverse=True)
    return summaries
