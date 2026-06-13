def test_get_and_update_profile(client, auth_a):
    profile = client.get("/api/me/profile", headers=auth_a)
    assert profile.status_code == 200
    data = profile.get_json()
    assert data["email"] == "alice@example.com"
    assert "post_count" in data

    updated = client.put(
        "/api/me/profile",
        json={"bio": "自动化测试用户", "campus": "仙林", "tags": ["测试"]},
        headers=auth_a,
    )
    assert updated.status_code == 200
    body = updated.get_json()
    assert body["bio"] == "自动化测试用户"
    assert body["campus"] == "仙林"
    assert body["tags"] == ["测试"]


def test_profile_requires_auth(client):
    assert client.get("/api/me/profile").status_code == 401
