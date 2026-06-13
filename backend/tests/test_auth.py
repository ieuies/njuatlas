from app import db
from app.models import User

from tests.helpers import create_verified_user, login


def test_auth_config(client):
    response = client.get("/api/user/auth-config")
    assert response.status_code == 200
    payload = response.get_json()
    assert "registration_email_restriction_enabled" in payload
    assert "registration_email_suffixes" in payload


def test_register_login_logout(client, monkeypatch):
    monkeypatch.setattr("app.routes.auth._new_email_code", lambda: "123456")

    assert client.post(
        "/api/user/email/code",
        json={"email": "newbie@example.com", "purpose": "register"},
    ).status_code == 200

    register = client.post(
        "/api/user/register",
        json={
            "email": "newbie@example.com",
            "code": "123456",
            "password": "securepass1",
            "username": "newbie",
        },
    )
    assert register.status_code == 201
    token = register.get_json()["access_token"]

    login_resp = client.post(
        "/api/user/login",
        json={"email": "newbie@example.com", "password": "securepass1"},
    )
    assert login_resp.status_code == 200

    assert client.post("/api/user/logout", headers={"Authorization": f"Bearer {token}"}).status_code == 200

    blocked = client.post(
        "/api/posts",
        json={"title": "x", "content": "y"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert blocked.status_code == 401


def test_login_rejects_unverified_email(client, app):
    with app.app_context():
        from werkzeug.security import generate_password_hash

        db.session.add(
            User(
                email="pending@example.com",
                username="pending",
                password_hash=generate_password_hash("securepass1"),
                email_verified=False,
            )
        )
        db.session.commit()

    response = client.post(
        "/api/user/login",
        json={"email": "pending@example.com", "password": "securepass1"},
    )
    assert response.status_code == 403
    assert response.get_json()["error"] == "email_not_verified"


def test_login_rejects_wrong_password(client, app):
    with app.app_context():
        create_verified_user(email="good@example.com", password="correctpass1")

    response = client.post(
        "/api/user/login",
        json={"email": "good@example.com", "password": "wrongpass1"},
    )
    assert response.status_code == 401
    assert response.get_json()["error"] == "invalid_credentials"


def test_protected_route_requires_auth(client):
    response = client.post("/api/posts", json={"title": "t", "content": "c"})
    assert response.status_code == 401
