# app/errors.py
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.exceptions import HTTPException

from flask import jsonify

from app import db
from app.config import ConfigError
from app.logging_utils import log_event
from app.validators import ValidationError


def _json_error(message, status_code, *, code=None):
    """生成统一 JSON 错误响应。

    所有错误响应保持同一结构，前端只需要读取 error/message/status_code。
    code 是给前端做分支处理的稳定错误码，不依赖中文文案。
    """
    body = {
        "error": code or "error",
        "message": message,
        "status_code": status_code,
    }
    return jsonify(body), status_code


def error_response(message, status_code, *, code=None):
    """Return an expected route error using the global JSON error schema."""
    return _json_error(message, status_code, code=code)


def register_error_handlers(app):
    """注册全局错误处理器。

    目标：
    - 参数错误返回 JSON，而不是 Flask 默认 HTML；
    - 数据库错误先 rollback，避免当前请求污染后续数据库会话；
    - 未预期异常只返回通用信息，详细堆栈留给服务端日志。
    """

    @app.errorhandler(ValidationError)
    def handle_validation_error(error):
        return _json_error(str(error), 400, code="validation_error")

    @app.errorhandler(ConfigError)
    def handle_config_error(error):
        log_event(app.logger, "config_error", level="error", error=str(error))
        return _json_error("服务配置错误，请检查环境变量。", 500, code="config_error")

    @app.errorhandler(SQLAlchemyError)
    def handle_database_error(error):
        db.session.rollback()
        log_event(app.logger, "database_error", level="error", error=str(error))
        return _json_error("数据库操作失败。", 500, code="database_error")

    @app.errorhandler(HTTPException)
    def handle_http_error(error):
        message = error.description or error.name
        return _json_error(message, error.code, code=error.name.lower().replace(" ", "_"))

    @app.errorhandler(Exception)
    def handle_unexpected_error(error):
        log_event(app.logger, "unhandled_exception", level="error", error=str(error))
        return _json_error("服务器内部错误。", 500, code="internal_server_error")
