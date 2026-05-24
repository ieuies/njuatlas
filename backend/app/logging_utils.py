# app/logging_utils.py
import json
import logging
import sys
from datetime import datetime, timezone

from flask import has_request_context, request


def configure_logging(app):
    """配置应用日志。

    Render 会自动收集标准输出和标准错误，所以这里把日志写到 stdout。
    日志使用 JSON 行格式，后续无论是在 Render 控制台检索，还是接入日志平台，都更容易过滤。
    """
    level_name = app.config.get("LOG_LEVEL", "INFO")
    level = getattr(logging, str(level_name).upper(), logging.INFO)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(message)s"))

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(level)

    app.logger.handlers.clear()
    app.logger.propagate = True
    app.logger.setLevel(level)


def log_event(logger, event, level="info", **fields):
    """写一条结构化事件日志。

    注意：
    - 不记录密码、token、API Key 等敏感字段；
    - 有请求上下文时自动补充 method/path/ip；
    - fields 只放排查问题需要的最小信息。
    """
    payload = {
        "event": event,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **fields,
    }

    if has_request_context():
        payload.update({
            "method": request.method,
            "path": request.path,
            "remote_addr": request.headers.get("X-Forwarded-For", request.remote_addr),
        })

    log_method = getattr(logger, level, logger.info)
    log_method(json.dumps(payload, ensure_ascii=False, default=str))
