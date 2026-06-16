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


def _clear_post_search_cache():
    from app.services import note as note_module
    note_module._SEARCH_CACHE.clear()


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


def test_hot_sort_unchanged(client, auth_a, auth_b):
    """sort=hot 仍按 hot_score 降序，不受 nearby 改动影响。"""
    _clear_post_search_cache()
    low = _create_post(
        client, auth_a,
        title="低热度帖", content="c1", tags=["测试"],
        urgency="now", location="118.780,32.058",
    ).get_json()["id"]
    high = _create_post(
        client, auth_a,
        title="高热度帖", content="c2", tags=["测试"],
        urgency="now", location="118.954,32.114",
    ).get_json()["id"]
    client.post(f"/api/posts/{high}/like", headers=auth_b)
    _clear_post_search_cache()

    listed = client.get("/api/posts?sort=hot&page=1&page_size=20")
    ids = [item["id"] for item in listed.get_json()["items"]]
    assert ids.index(high) < ids.index(low)


def test_nearby_sort_tiers(client, auth_a, auth_b):
    """nearby：tier0 距离优先 > tier1 长期 > tier2 满员；同 tier 近者优先。"""
    client.put(
        "/api/me/profile",
        json={"campus": "仙林"},
        headers=auth_a,
    )
    _clear_post_search_cache()

    near_now = _create_post(
        client, auth_a,
        title="近-立即", content="n1", tags=["排序测"],
        urgency="now", location="118.950,32.110", location_name="仙林近",
    ).get_json()["id"]
    far_now = _create_post(
        client, auth_a,
        title="远-立即", content="n2", tags=["排序测"],
        urgency="now", location="118.780,32.058", location_name="鼓楼",
    ).get_json()["id"]
    long_term = _create_post(
        client, auth_a,
        title="长期", content="lt", tags=["排序测"],
        urgency="long_term", location="118.950,32.110", location_name="仙林长期",
    ).get_json()["id"]
    no_loc = _create_post(
        client, auth_a,
        title="无坐标", content="nl", tags=["排序测"],
        urgency="now", location="", location_name="未知",
    ).get_json()["id"]
    full_event = _create_post(
        client, auth_a,
        title="满员活动", content="full", tags=["排序测"],
        type="event", urgency="now", location="118.950,32.110",
        slots=2,
    ).get_json()["id"]
    client.post(
        f"/api/posts/{full_event}/participate",
        json={"status": "going"},
        headers=auth_b,
    )
    _clear_post_search_cache()

    listed = client.get("/api/posts?sort=nearby&page=1&page_size=20", headers=auth_a)
    assert listed.status_code == 200
    ids = [item["id"] for item in listed.get_json()["items"]]

    tier0 = [near_now, far_now, no_loc]
    for pid in tier0:
        assert ids.index(pid) < ids.index(long_term)
        assert ids.index(pid) < ids.index(full_event)
    assert ids.index(near_now) < ids.index(far_now)
    assert ids.index(far_now) < ids.index(no_loc)
    assert ids.index(long_term) < ids.index(full_event)
