from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from app.redis_utils import probe_redis_url


# 生产环境用 Redis；Redis 短暂不可用时启用内存回退，避免整站 500。
limiter = Limiter(
    key_func=get_remote_address,
    storage_options={
        "socket_connect_timeout": 2,
        "socket_timeout": 2,
    },
    in_memory_fallback_enabled=True,
    swallow_errors=True,
)


def init_rate_limiter(app):
    """Bind Flask-Limiter to the app with environment-driven defaults."""
    storage_uri = (app.config.get("RATELIMIT_STORAGE_URI") or "memory://").strip()
    if storage_uri and storage_uri != "memory://":
        if not probe_redis_url(storage_uri, label="RATELIMIT Redis"):
            app.logger.warning(
                "RATELIMIT Redis unavailable at startup, falling back to memory://"
            )
            app.config["RATELIMIT_STORAGE_URI"] = "memory://"

    # 与 Limiter 构造参数一致；config 项供 init_app 二次读取。
    app.config.setdefault("RATELIMIT_IN_MEMORY_FALLBACK_ENABLED", True)
    app.config.setdefault("RATELIMIT_SWALLOW_ERRORS", True)
    limiter.init_app(app)
