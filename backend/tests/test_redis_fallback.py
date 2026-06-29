"""Redis 降级与限流回退相关测试。"""

import os


def test_rate_limiter_falls_back_when_redis_unreachable(monkeypatch):
    monkeypatch.setenv("RATELIMIT_STORAGE_URI", "redis://127.0.0.1:6399/0")
    monkeypatch.setenv("RATELIMIT_DEFAULT", "200 per hour")
    monkeypatch.setenv("GAODE_API_KEY", "test-gaode-key")
    monkeypatch.setenv("SECRET_KEY", "x" * 32)
    monkeypatch.setenv("BAILIAN_API_KEY", "test-bailian-key")
    monkeypatch.delenv("REDIS_URL", raising=False)

    from app import create_app

    app = create_app()
    assert app.config["RATELIMIT_STORAGE_URI"] == "memory://"

    with app.test_client() as client:
        response = client.get("/api/posts?page=1&page_size=5")
        assert response.status_code == 200


def test_probe_redis_url_rejects_bad_host():
    from app.redis_utils import probe_redis_url

    assert probe_redis_url("redis://127.0.0.1:6399/0", label="test") is False
