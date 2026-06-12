"""用户级实时事件（SSE + Redis pub/sub，无 Redis 时本 worker 内存回退）。"""
import json
import queue
import threading

CHANNEL_PREFIX = "njuatlas:user:"


class RealtimeHub:
    def __init__(self):
        self._lock = threading.Lock()
        self._local_queues = {}
        self._redis_client = None
        self._mode = "local"

    def init_app(self, app):
        url = (app.config.get("REDIS_URL") or "").strip()
        if not url:
            app.logger.info("realtime: REDIS_URL 未配置，使用本 worker 内存通道（多 worker 需 Redis）")
            return
        try:
            import redis

            client = redis.from_url(url, decode_responses=True)
            client.ping()
            self._redis_client = client
            self._mode = "redis"
            app.logger.info("realtime: Redis pub/sub 已启用")
        except Exception as exc:
            app.logger.warning("realtime: Redis 连接失败，回退内存模式: %s", exc)

    @property
    def mode(self):
        return self._mode

    def _channel(self, user_id):
        return f"{CHANNEL_PREFIX}{int(user_id)}"

    def publish(self, user_id, event_type, data):
        payload = json.dumps({"type": event_type, "data": data}, ensure_ascii=False)
        if self._redis_client:
            try:
                self._redis_client.publish(self._channel(user_id), payload)
            except Exception:
                pass
        with self._lock:
            for q in list(self._local_queues.get(int(user_id), ())):
                try:
                    q.put_nowait(payload)
                except queue.Full:
                    pass

    def subscribe(self, user_id):
        uid = int(user_id)
        q = queue.Queue(maxsize=128)
        with self._lock:
            self._local_queues.setdefault(uid, set()).add(q)

        pubsub = None
        if self._redis_client:
            pubsub = self._redis_client.pubsub(ignore_subscribe_messages=True)
            pubsub.subscribe(self._channel(uid))

        stop = threading.Event()

        def _redis_loop():
            if not pubsub:
                return
            while not stop.is_set():
                try:
                    message = pubsub.get_message(timeout=1.0)
                except Exception:
                    break
                if not message or message.get("type") != "message":
                    continue
                try:
                    q.put_nowait(message.get("data") or "")
                except queue.Full:
                    pass

        listener = threading.Thread(target=_redis_loop, daemon=True)
        listener.start()
        return q, pubsub, stop, listener

    def unsubscribe(self, user_id, q, pubsub, stop, listener):
        uid = int(user_id)
        stop.set()
        if listener.is_alive():
            listener.join(timeout=1.0)
        if pubsub:
            try:
                pubsub.unsubscribe()
                pubsub.close()
            except Exception:
                pass
        with self._lock:
            subs = self._local_queues.get(uid)
            if subs:
                subs.discard(q)
                if not subs:
                    self._local_queues.pop(uid, None)

    def stream(self, user_id):
        q, pubsub, stop, listener = self.subscribe(user_id)
        try:
            yield f"event: ready\ndata: {json.dumps({'mode': self._mode})}\n\n"
            while True:
                try:
                    raw = q.get(timeout=20)
                    yield f"event: message\ndata: {raw}\n\n"
                except queue.Empty:
                    yield ": ping\n\n"
        finally:
            self.unsubscribe(user_id, q, pubsub, stop, listener)


hub = RealtimeHub()


def publish_dm_event(user_id, peer_id, message):
    hub.publish(user_id, "dm", {"peer_id": int(peer_id), "message": message})


def publish_unread_refresh(user_id):
    hub.publish(user_id, "unread", {})
