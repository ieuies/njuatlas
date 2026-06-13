def _create_post(client, headers, **extra):
    payload = {
        "type": "forum",
        "title": "找羽毛球搭子",
        "content": "仙林校区每周三下午",
        "tags": ["羽毛球", "仙林"],
        "urgency": "long_term",
        "location": "118.93021,32.10247",
        "location_name": "仙林校区",
    }
    payload.update(extra)
    return client.post("/api/posts", json=payload, headers=headers)


def test_create_list_and_detail(client, auth_a):
    created = _create_post(client, auth_a)
    assert created.status_code == 201
    body = created.get_json()
    assert body["title"] == "找羽毛球搭子"
    post_id = body["id"]

    listed = client.get("/api/posts?page=1&page_size=10")
    assert listed.status_code == 200
    items = listed.get_json()["items"]
    assert any(item["id"] == post_id for item in items)

    detail = client.get(f"/api/posts/{post_id}")
    assert detail.status_code == 200
    assert detail.get_json()["title"] == "找羽毛球搭子"


def test_create_post_validation(client, auth_a):
    response = client.post(
        "/api/posts",
        json={"title": "", "content": ""},
        headers=auth_a,
    )
    assert response.status_code == 400


def test_post_like_comment_favorite_participate(client, auth_a, auth_b, user_a, user_b):
    created = _create_post(client, auth_a)
    post_id = created.get_json()["id"]

    like = client.post(f"/api/posts/{post_id}/like", headers=auth_b)
    assert like.status_code == 200
    assert like.get_json()["liked"] is True

    comment = client.post(
        f"/api/posts/{post_id}/comments",
        json={"content": "我也想去"},
        headers=auth_b,
    )
    assert comment.status_code == 201

    comments = client.get(f"/api/posts/{post_id}/comments")
    assert comments.status_code == 200
    assert len(comments.get_json()["items"]) >= 1

    favorite = client.post(f"/api/posts/{post_id}/favorite", headers=auth_b)
    assert favorite.status_code == 200
    assert favorite.get_json()["favorited"] is True

    participate = client.post(
        f"/api/posts/{post_id}/participate",
        json={"status": "going"},
        headers=auth_b,
    )
    assert participate.status_code == 200
    assert participate.get_json()["status"] == "going"
