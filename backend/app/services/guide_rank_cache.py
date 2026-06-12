"""吃喝玩乐排行榜 Redis ZSET 缓存（方案 C）。

likes 表仍为真源；ZSET 按 campus + guide_category 缓存 place_id → like_count。
无 Redis 时自动回退到 SQL 聚合。
"""

import logging
import os

from flask import current_app

from app.models import Like, Place, Review

logger = logging.getLogger(__name__)

_RANK_KEY_PREFIX = "guide:rank:"
_REDIS_SOCKET_TIMEOUT = 3
_redis_client = None
_redis_pid = None


def rank_key(campus, guide_category):
    return f"{_RANK_KEY_PREFIX}{campus}:{guide_category}"


def _redis():
    global _redis_client, _redis_pid
    url = (current_app.config.get("REDIS_URL") or "").strip()
    if not url:
        return None
    pid = os.getpid()
    if _redis_client is not None and _redis_pid == pid:
        return _redis_client
    try:
        import redis

        client = redis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=_REDIS_SOCKET_TIMEOUT,
            socket_timeout=_REDIS_SOCKET_TIMEOUT,
        )
        client.ping()
        _redis_client = client
        _redis_pid = pid
        return client
    except Exception as exc:
        logger.warning("guide rank cache: Redis unavailable: %s", exc)
        _redis_client = None
        _redis_pid = None
        return None


def sync_place_rank(place, like_count=None):
    """将店铺点赞数写入 ZSET；0 赞时移除。"""
    if not place or not place.campus or not place.guide_category:
        return
    client = _redis()
    if client is None:
        return
    if like_count is None:
        like_count = Like.query.filter_by(place_id=place.id).count()
    key = rank_key(place.campus, place.guide_category)
    member = str(place.id)
    try:
        if like_count <= 0:
            client.zrem(key, member)
        else:
            client.zadd(key, {member: like_count})
    except Exception as exc:
        logger.warning("guide rank cache sync failed place=%s: %s", place.id, exc)


def warm_rank_cache(campus, guide_category, scored_places):
    """用 SQL 查询结果回填 ZSET（冷启动）。"""
    client = _redis()
    if client is None or not scored_places:
        return
    key = rank_key(campus, guide_category)
    mapping = {str(place_id): score for place_id, score in scored_places if score > 0}
    if not mapping:
        return
    try:
        client.zadd(key, mapping)
    except Exception as exc:
        logger.warning("guide rank cache warm failed %s: %s", key, exc)


def fetch_ranked_places(campus, guide_category, limit=25):
    """从 ZSET 读取排行店铺；无 Redis 或空榜时返回 None 供 SQL 回退。"""
    client = _redis()
    if client is None:
        return None
    key = rank_key(campus, guide_category)
    try:
        rows = client.zrevrange(key, 0, max(limit - 1, 0), withscores=True)
    except Exception as exc:
        logger.warning("guide rank cache read failed %s: %s", key, exc)
        return None
    if not rows:
        return None

    place_ids = [int(member) for member, _score in rows]
    places = Place.query.filter(Place.id.in_(place_ids)).all()
    by_id = {p.id: p for p in places}
    items = []
    for member, score in rows:
        place_id = int(member)
        place = by_id.get(place_id)
        if not place:
            continue
        review_count = Review.query.filter_by(place_id=place.id).count()
        items.append((place, int(score), review_count))
    return items if items else None
