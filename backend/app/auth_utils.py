import base64
import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime
from functools import wraps

from flask import current_app, g, request

_revoked_jti_cache = {}
_user_id_cache = {}
_CACHE_MAX_SIZE = 2048


def _cache_prune(cache, now=None):
    now = now or time.time()
    expired = [key for key, (_, exp) in cache.items() if exp <= now]
    for key in expired:
        cache.pop(key, None)
    if len(cache) > _CACHE_MAX_SIZE:
        for key in list(cache.keys())[: len(cache) - _CACHE_MAX_SIZE]:
            cache.pop(key, None)


def _is_jti_revoked(jti, exp_ts):
    now = time.time()
    _cache_prune(_revoked_jti_cache, now)
    cached = _revoked_jti_cache.get(jti)
    if cached is not None:
        return cached[0]
    from app.models import RevokedToken

    revoked = RevokedToken.query.filter_by(jti=jti).first() is not None
    _revoked_jti_cache[jti] = (revoked, exp_ts)
    return revoked


def _get_cached_user(user_id, exp_ts):
    now = time.time()
    _cache_prune(_user_id_cache, now)
    cached = _user_id_cache.get(user_id)
    if cached is not None:
        return cached[0]
    from app.models import User

    user = User.query.get(user_id)
    if user:
        _user_id_cache[user_id] = (user, exp_ts)
    return user


def invalidate_jwt_cache(jti=None, user_id=None):
    if jti:
        _revoked_jti_cache.pop(jti, None)
    if user_id is not None:
        _user_id_cache.pop(user_id, None)


def _base64url_encode(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _base64url_decode(value):
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def _json_dumps(data):
    return json.dumps(data, separators=(",", ":"), sort_keys=True).encode("utf-8")


def _sign(message, secret):
    return hmac.new(secret.encode("utf-8"), message.encode("ascii"), hashlib.sha256).digest()


def hash_token(token):
    """Store only a token hash so database leaks do not expose usable tokens."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_access_token(user):
    """Issue a signed JWT access token.

    The jti claim is a unique token id. Logout and password changes revoke that
    id in the database, giving this stateless JWT implementation a blacklist.
    """
    now = int(time.time())
    expires_in = current_app.config["JWT_EXPIRATION_SECONDS"]
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": user.id,
        "email": user.email,
        "jti": str(uuid.uuid4()),
        "iat": now,
        "exp": now + expires_in,
    }

    encoded_header = _base64url_encode(_json_dumps(header))
    encoded_payload = _base64url_encode(_json_dumps(payload))
    signing_input = f"{encoded_header}.{encoded_payload}"
    signature = _base64url_encode(_sign(signing_input, current_app.config["SECRET_KEY"]))

    return f"{signing_input}.{signature}", expires_in


def decode_access_token(token):
    parts = token.split(".")
    if len(parts) != 3:
        return None, "token 格式无效"

    encoded_header, encoded_payload, encoded_signature = parts
    signing_input = f"{encoded_header}.{encoded_payload}"
    expected_signature = _base64url_encode(_sign(signing_input, current_app.config["SECRET_KEY"]))

    if not hmac.compare_digest(encoded_signature, expected_signature):
        return None, "token 签名无效"

    try:
        header = json.loads(_base64url_decode(encoded_header))
        payload = json.loads(_base64url_decode(encoded_payload))
    except (ValueError, json.JSONDecodeError):
        return None, "token 内容无效"

    if header.get("alg") != "HS256" or header.get("typ") != "JWT":
        return None, "token 算法无效"

    if int(time.time()) >= int(payload.get("exp", 0)):
        return None, "token 已过期"

    if not payload.get("sub"):
        return None, "token 缺少用户身份"

    if not payload.get("jti"):
        return None, "token 缺少 jti"

    return payload, None


def extract_bearer_token():
    auth_header = request.headers.get("Authorization", "")
    scheme, _, token = auth_header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


def revoke_current_token():
    """Blacklist the current request token until its natural expiry."""
    if not getattr(g, "current_token_payload", None):
        return None

    from app import db
    from app.models import RevokedToken

    payload = g.current_token_payload
    existing = RevokedToken.query.filter_by(jti=payload["jti"]).first()
    if existing:
        return existing

    revoked = RevokedToken(
        jti=payload["jti"],
        user_id=g.current_user_id,
        expires_at=datetime.utcfromtimestamp(int(payload["exp"])),
    )
    db.session.add(revoked)
    invalidate_jwt_cache(jti=payload["jti"], user_id=g.current_user_id)
    return revoked


def jwt_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        from app.errors import error_response
        from app.models import RevokedToken, User

        token = extract_bearer_token()
        if not token:
            return error_response("缺少 Authorization Bearer token", 401, code="missing_token")

        payload, error = decode_access_token(token)
        if error:
            return error_response(error, 401, code="invalid_token")

        exp_ts = int(payload.get("exp", 0))
        if _is_jti_revoked(payload["jti"], exp_ts):
            return error_response("token 已失效", 401, code="revoked_token")

        user = _get_cached_user(payload["sub"], exp_ts)
        if not user:
            return error_response("用户不存在", 401, code="user_not_found")

        g.current_token = token
        g.current_token_payload = payload
        g.current_user = user
        g.current_user_id = user.id
        return view_func(*args, **kwargs)

    return wrapper


def jwt_optional(view_func):
    """可选 JWT 认证：有 token 就解析并设置 g.current_user_id，没有也不报错。"""
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        from app.models import RevokedToken, User

        token = extract_bearer_token()
        if token:
            payload, error = decode_access_token(token)
            exp_ts = int(payload.get("exp", 0)) if payload else 0
            if not error and not _is_jti_revoked(payload["jti"], exp_ts):
                user = _get_cached_user(payload["sub"], exp_ts)
                if user:
                    g.current_token = token
                    g.current_token_payload = payload
                    g.current_user = user
                    g.current_user_id = user.id
        return view_func(*args, **kwargs)

    return wrapper
