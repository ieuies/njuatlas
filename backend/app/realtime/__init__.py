"""私信/通知 SSE 实时推送（Redis pub/sub，无 Redis 时进程内回退）。"""
import json
import logging
import queue
import threading
import time
from collections import defaultdict

logger = logging.getLogger(__name__)

KEEPALIVE_SECONDS = 25
_CHANNEL_PREFIX = "njuatlas:events:"


def _sse_event(event_name, payload):
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event_name}\ndata: {data}\n\n"


class RealtimeHub:
    def __init__(self):
        self._redis = None
        self._mode = "memory"
        self._lock = threading.Lock()
        self._subscribers = defaultdict(list)

    @property
    def mode(self):
        return self._mode

    def init_app(self, app):
        redis_url = (app.config.get("REDIS_URL") or "").strip()
        if not redis_url:
            logger.info("REDIS_URL 未配置，SSE 使用进程内队列（单 worker 有效）")
            self._mode = "memory"
            return

        try:
            import redis

            client = redis.from_url(redis_url, decode_responses=True)
            client.ping()
        except Exception as exc:
            logger.warning("Redis 不可用，SSE 回退到进程内队列: %s", exc)
            self._mode = "memory"
            self._redis = None
            return

        self._redis = client
        self._mode = "redis"
        logger.info("SSE 实时推送已启用 Redis pub/sub")

    def _channel(self, user_id):
        return f"{_CHANNEL_PREFIX}{int(user_id)}"

    def publish(self, user_id, payload):
        user_id = int(user_id)
        message = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        if self._redis is not None:
            try:
                self._redis.publish(self._channel(user_id), message)
            except Exception as exc:
                logger.warning("Redis publish 失败 user=%s: %s", user_id, exc)
            return

        with self._lock:
            targets = list(self._subscribers.get(user_id, []))
        for target in targets:
            try:
                target.put_nowait(message)
            except queue.Full:
                pass

    def stream(self, user_id):
        user_id = int(user_id)
        yield _sse_event("ready", {})

        if self._redis is not None:
            yield from self._stream_redis(user_id)
        else:
            yield from self._stream_memory(user_id)

    def _stream_redis(self, user_id):
        pubsub = self._redis.pubsub(ignore_subscribe_messages=True)
        channel = self._channel(user_id)
        pubsub.subscribe(channel)
        last_ping = time.monotonic()
        try:
            while True:
                item = pubsub.get_message(timeout=1.0)
                if item and item.get("type") == "message":
                    data = item.get("data")
                    if data:
                        yield _sse_event("message", json.loads(data))
                if time.monotonic() - last_ping >= KEEPALIVE_SECONDS:
                    yield ": keepalive\n\n"
                    last_ping = time.monotonic()
        finally:
            try:
                pubsub.unsubscribe(channel)
                pubsub.close()
            except Exception:
                pass

    def _stream_memory(self, user_id):
        event_queue = queue.Queue(maxsize=64)
        with self._lock:
            self._subscribers[user_id].append(event_queue)
        last_ping = time.monotonic()
        try:
            while True:
                try:
                    data = event_queue.get(timeout=1.0)
                    yield _sse_event("message", json.loads(data))
                except queue.Empty:
                    pass
                if time.monotonic() - last_ping >= KEEPALIVE_SECONDS:
                    yield ": keepalive\n\n"
                    last_ping = time.monotonic()
        finally:
            with self._lock:
                subs = self._subscribers.get(user_id, [])
                if event_queue in subs:
                    subs.remove(event_queue)
                if not subs:
                    self._subscribers.pop(user_id, None)


hub = RealtimeHub()


def publish_dm_event(user_id, peer_id, message):
    hub.publish(
        user_id,
        {
            "type": "dm",
            "data": {
                "peer_id": int(peer_id),
                "message": message,
            },
        },
    )


def publish_unread_refresh(user_id):
    hub.publish(user_id, {"type": "unread"})
