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
    limiter.init_app(app)
