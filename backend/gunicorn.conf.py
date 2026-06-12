"""Gunicorn 配置：gthread 支持 SSE 长连接与其它 API 并发。"""
import os

bind = f"0.0.0.0:{os.environ.get('PORT', '5000')}"
worker_class = "gthread"
workers = int(os.environ.get("WEB_CONCURRENCY", "1"))
threads = int(os.environ.get("GUNICORN_THREADS", "16"))
timeout = 120
keepalive = 5
preload_app = True
