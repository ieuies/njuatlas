# app/config.py
import os


class ConfigError(RuntimeError):
    """应用配置错误。

    这类错误通常不是代码逻辑 bug，而是部署环境缺少必需的环境变量。
    让应用在启动时直接失败，比运行到某个接口时才报错更容易排查，也更安全。
    """


def _get_env(name, default=None):
    """读取并清洗环境变量。

    所有密钥都从操作系统环境变量读取：
    - 本地开发时，python-dotenv 会把 backend/.env 加载进环境变量；
    - Render 部署时，环境变量来自 Render 控制台；
    - 代码仓库中不保存真实密钥。
    """
    value = os.getenv(name, default)
    if value is None:
        return None
    return str(value).strip()


def _get_int_env(name, default):
    """读取整数型环境变量，并给出明确错误。"""
    value = _get_env(name, str(default))
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ConfigError(f"{name} 必须是整数，当前值为 {value!r}") from exc


def _normalize_database_url(value):
    """规范化数据库连接字符串。

    本地开发不配置 DATABASE_URL 时，Flask-SQLAlchemy 会使用默认 SQLite 文件。
    Render PostgreSQL 通常会提供 DATABASE_URL。这里做三层兼容转换：
    1. postgres:// → postgresql+psycopg://（旧格式，如 Render）
    2. postgresql:// → postgresql+psycopg://（Neon 默认格式）
    3. 强制使用 psycopg 3.x 驱动，因为 Windows + Python 3.14 不支持 psycopg2
    """
    if not value:
        return None

    # 统一转换为 postgresql+psycopg 协议（使用 psycopg v3 驱动）
    if value.startswith("postgresql+psycopg://"):
        return value  # 已经是正确的格式
    if value.startswith("postgresql://"):
        return "postgresql+psycopg://" + value[len("postgresql://"):]
    if value.startswith("postgres://"):
        return "postgresql+psycopg://" + value[len("postgres://"):]

    return value


class Config:
    """Flask 应用配置。

    密钥配置集中放在这里，业务代码只从 current_app.config 读取。
    这样可以避免 API Key 分散在多个模块里直接 os.getenv()，也便于部署时统一校验。
    """

    GAODE_API_KEY = _get_env("GAODE_API_KEY")
    ZHIPU_API_KEY = _get_env("ZHIPU_API_KEY", "")
    BAILIAN_API_KEY = _get_env("BAILIAN_API_KEY", "")
    SECRET_KEY = _get_env("SECRET_KEY")
    JWT_EXPIRATION_SECONDS = _get_int_env("JWT_EXPIRATION_SECONDS", 60 * 60 * 24)
    SQLALCHEMY_DATABASE_URI = _normalize_database_url(_get_env("DATABASE_URL"))
    AMAP_CACHE_TTL_SECONDS = _get_int_env("AMAP_CACHE_TTL_SECONDS", 5 * 60)
    AMAP_CACHE_MAX_ITEMS = _get_int_env("AMAP_CACHE_MAX_ITEMS", 256)
    AMAP_REQUEST_TIMEOUT_SECONDS = _get_int_env("AMAP_REQUEST_TIMEOUT_SECONDS", 8)
    LOG_LEVEL = _get_env("LOG_LEVEL", "INFO")
    CONVERSATION_HISTORY_LIMIT = _get_int_env("CONVERSATION_HISTORY_LIMIT", 20)
    RATELIMIT_DEFAULT = _get_env("RATELIMIT_DEFAULT", "200 per hour")
    RATELIMIT_STORAGE_URI = _get_env("RATELIMIT_STORAGE_URI", "memory://")
    FRONTEND_URL = _get_env("FRONTEND_URL", "http://localhost:5173")
    EMAIL_VERIFICATION_TOKEN_SECONDS = _get_int_env("EMAIL_VERIFICATION_TOKEN_SECONDS", 60 * 60 * 24)
    PASSWORD_RESET_TOKEN_SECONDS = _get_int_env("PASSWORD_RESET_TOKEN_SECONDS", 60 * 30)
    EMAIL_CODE_EXPIRATION_SECONDS = _get_int_env("EMAIL_CODE_EXPIRATION_SECONDS", 10 * 60)
    EMAIL_CODE_RESEND_SECONDS = _get_int_env("EMAIL_CODE_RESEND_SECONDS", 60)
    EMAIL_CODE_MAX_ATTEMPTS = _get_int_env("EMAIL_CODE_MAX_ATTEMPTS", 5)
    RESEND_API_KEY = _get_env("RESEND_API_KEY", "")
    MAIL_FROM = _get_env("MAIL_FROM", "no-reply@njuatlas.local")

    SQLALCHEMY_TRACK_MODIFICATIONS = False


def validate_config(app):
    """启动时校验安全相关配置。

    校验规则：
    1. SECRET_KEY 必须配置，JWT 签名依赖它；
    2. SECRET_KEY 不能继续使用文档里的占位值；
    3. GAODE_API_KEY 必须配置，否则地图搜索功能不可用；
    4. 智谱和百炼至少配置一个，否则 AI 推荐功能不可用。
    """
    secret_key = app.config.get("SECRET_KEY")
    if not secret_key or secret_key in {"dev-only-change-me", "请替换为随机长密钥"}:
        raise ConfigError("缺少有效的 SECRET_KEY，请在 .env 或 Render 环境变量中配置随机长密钥。")

    if len(secret_key) < 32:
        raise ConfigError("SECRET_KEY 长度过短，请使用至少 32 个字符的随机字符串。")

    if not app.config.get("GAODE_API_KEY"):
        raise ConfigError("缺少 GAODE_API_KEY，请在 .env 或 Render 环境变量中配置高德地图 API Key。")

    if not app.config.get("ZHIPU_API_KEY") and not app.config.get("BAILIAN_API_KEY"):
        raise ConfigError("缺少大模型 API Key，请至少配置 ZHIPU_API_KEY 或 BAILIAN_API_KEY。")
