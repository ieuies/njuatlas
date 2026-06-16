"""Pytest fixtures for NJUAtlas backend."""

from __future__ import annotations

import os

import pytest

os.environ.setdefault("SECRET_KEY", "test-secret-key-at-least-32-characters-long")
os.environ.setdefault("GAODE_API_KEY", "test-gaode-api-key")
os.environ.setdefault("BAILIAN_API_KEY", "test-bailian-api-key")
os.environ.setdefault("LLM_PROVIDER", "bailian")
os.environ.setdefault("REGISTER_EMAIL_RESTRICTION_ENABLED", "false")
os.environ.setdefault("RATELIMIT_STORAGE_URI", "memory://")
os.environ.pop("RESEND_API_KEY", None)
os.environ.pop("REDIS_URL", None)

from app import create_app, db
from app.auth_utils import _revoked_jti_cache, _user_id_cache
from app.db_utils import initialize_database
from app.rate_limit import limiter

from tests.helpers import auth_header, create_verified_user, login


@pytest.fixture(scope="session")
def app(tmp_path_factory):
    db_path = tmp_path_factory.mktemp("db") / "pytest.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"

    application = create_app()
    application.config["TESTING"] = True
    limiter.enabled = False

    import app.auth_utils as auth_utils

    def _fresh_cached_user(user_id, exp_ts):
        from app.models import User

        return db.session.get(User, user_id)

    auth_utils._get_cached_user = _fresh_cached_user

    with application.app_context():
        initialize_database()

    yield application


@pytest.fixture(autouse=True)
def reset_database(app):
    with app.app_context():
        for table in reversed(db.metadata.sorted_tables):
            db.session.execute(table.delete())
        db.session.commit()
        _user_id_cache.clear()
        _revoked_jti_cache.clear()
    yield
    with app.app_context():
        db.session.rollback()


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def user_a(app, client):
    with app.app_context():
        create_verified_user(
            email="alice@example.com",
            username="alice",
            password="testpass123",
        )
    token = login(client, "alice@example.com", "testpass123")
    return {"email": "alice@example.com", "username": "alice", "token": token}


@pytest.fixture
def user_b(app, client):
    with app.app_context():
        create_verified_user(
            email="bob@example.com",
            username="bob",
            password="testpass123",
        )
    token = login(client, "bob@example.com", "testpass123")
    return {"email": "bob@example.com", "username": "bob", "token": token}


@pytest.fixture
def auth_a(user_a):
    return auth_header(user_a["token"])


@pytest.fixture
def auth_b(user_b):
    return auth_header(user_b["token"])


@pytest.fixture
def user_c(app, client):
    with app.app_context():
        create_verified_user(
            email="carol@example.com",
            username="carol",
            password="testpass123",
        )
    token = login(client, "carol@example.com", "testpass123")
    return {"email": "carol@example.com", "username": "carol", "token": token}


@pytest.fixture
def auth_c(user_c):
    return auth_header(user_c["token"])
