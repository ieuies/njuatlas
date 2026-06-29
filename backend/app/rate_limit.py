from flask_limiter import Limiter
from flask_limiter.util import get_remote_address


# A single extension instance keeps rate-limit state centralized.
# The storage backend is configured from RATELIMIT_STORAGE_URI, so local
# development can use memory:// while production can switch to Redis later.
limiter = Limiter(
    key_func=get_remote_address,
)


def init_rate_limiter(app):
    """Bind Flask-Limiter to the app with environment-driven defaults."""
    storage_uri = (app.config.get("RATELIMIT_STORAGE_URI") or "memory://").strip()
    if storage_uri and storage_uri != "memory://":
        try:
            import redis

            client = redis.from_url(storage_uri, socket_connect_timeout=2, socket_timeout=2)
            client.ping()
        except Exception as exc:
            app.logger.warning(
                "RATELIMIT Redis unavailable (%s), falling back to memory://",
                exc,
            )
            app.config["RATELIMIT_STORAGE_URI"] = "memory://"
    limiter.init_app(app)
