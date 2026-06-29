"""Redis 连通性探测（限流 / SSE / 排行榜缓存共用）。"""

import logging

logger = logging.getLogger(__name__)

_REDIS_PROBE_TIMEOUT = 2


def probe_redis_url(url, *, label="Redis"):
    """尝试 ping Redis；失败时打 warning 并返回 False。"""
    if not (url or "").strip():
        return False
    try:
        import redis

        client = redis.from_url(
            url.strip(),
            socket_connect_timeout=_REDIS_PROBE_TIMEOUT,
            socket_timeout=_REDIS_PROBE_TIMEOUT,
        )
        client.ping()
        return True
    except Exception as exc:
        logger.warning("%s unavailable: %s", label, exc)
        return False
