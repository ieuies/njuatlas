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


def test_my_activities(client, auth_a, auth_b):
    created = client.post(
        "/api/posts",
        json={
            "type": "event",
            "title": "周五剧本杀",
            "content": "仙林校区",
            "tags": ["剧本杀"],
            "urgency": "long_term",
        },
        headers=auth_a,
    )
    assert created.status_code == 201
    post_id = created.get_json()["id"]

    participate = client.post(
        f"/api/posts/{post_id}/participate",
        json={"status": "going"},
        headers=auth_b,
    )
    assert participate.status_code == 200

    empty = client.get("/api/me/activities", headers=auth_a)
    assert empty.status_code == 200
    assert empty.get_json()["items"] == []

    activities = client.get("/api/me/activities", headers=auth_b)
    assert activities.status_code == 200
    items = activities.get_json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == post_id
    assert items[0]["participation_status"] == "going"
