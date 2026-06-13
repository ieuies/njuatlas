"""场所点赞：幂等设置与切换。"""

from sqlalchemy.exc import IntegrityError

from app import db
from app.models import Like


def _like_result(place, liked, *, changed):
    likes = Like.query.filter_by(place_id=place.id).count()
    return {
        "place_id": place.id,
        "liked": liked,
        "likes": likes,
        "changed": changed,
    }


def set_place_like(place, user_id, desired_liked):
    """将当前用户对该场所的点赞状态设为 desired_liked（幂等）。"""
    desired_liked = bool(desired_liked)
    existing = Like.query.filter_by(user_id=user_id, place_id=place.id).first()
    currently_liked = existing is not None

    if desired_liked == currently_liked:
        return _like_result(place, currently_liked, changed=False)

    try:
        if desired_liked:
            db.session.add(Like(user_id=user_id, place_id=place.id))
        else:
            db.session.delete(existing)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        if desired_liked:
            return _like_result(place, True, changed=False)
        existing = Like.query.filter_by(user_id=user_id, place_id=place.id).first()
        if existing:
            db.session.delete(existing)
            db.session.commit()
        return _like_result(place, False, changed=True)

    from app.services.guide_rank_cache import sync_place_rank
    from app.services.guide import invalidate_leaderboard_cache

    sync_place_rank(place)
    invalidate_leaderboard_cache()
    return _like_result(place, desired_liked, changed=True)


def toggle_place_like(place, user_id):
    """切换当前用户点赞状态（兼容旧客户端）。"""
    existing = Like.query.filter_by(user_id=user_id, place_id=place.id).first()
    return set_place_like(place, user_id, desired_liked=existing is None)
