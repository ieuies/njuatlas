"""Test helpers for NJUAtlas backend API tests."""

from __future__ import annotations

from datetime import datetime, timezone

from werkzeug.security import generate_password_hash

from app import db
from app.models import User


def create_verified_user(
    *,
    email: str = "alice@example.com",
    username: str = "alice",
    password: str = "testpass123",
) -> User:
    user = User(
        email=email,
        username=username,
        password_hash=generate_password_hash(password),
        email_verified=True,
        email_verified_at=datetime.now(timezone.utc),
    )
    db.session.add(user)
    db.session.commit()
    return user


def login(client, email: str, password: str) -> str:
    response = client.post("/api/user/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.get_json()
    return response.get_json()["access_token"]


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
