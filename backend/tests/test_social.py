def test_friend_request_accept_and_message(client, auth_a, auth_b):
    profile_a = client.get("/api/me/profile", headers=auth_a).get_json()
    profile_b = client.get("/api/me/profile", headers=auth_b).get_json()
    user_a_id = profile_a["id"]
    user_b_id = profile_b["id"]

    request_resp = client.post(
        "/api/social/friends/request",
        json={"user_id": user_b_id},
        headers=auth_a,
    )
    assert request_resp.status_code == 201
    request_id = request_resp.get_json()["id"]

    accept = client.post(
        f"/api/social/friends/requests/{request_id}/accept",
        headers=auth_b,
    )
    assert accept.status_code == 200
    assert accept.get_json()["status"] == "accepted"

    friends_a = client.get("/api/social/friends", headers=auth_a)
    assert friends_a.status_code == 200
    friend_ids = [item["id"] for item in friends_a.get_json()["items"]]
    assert user_b_id in friend_ids

    send = client.post(
        f"/api/social/messages/{user_b_id}",
        json={"content": "你好 Bob"},
        headers=auth_a,
    )
    assert send.status_code == 201

    messages = client.get(
        f"/api/social/messages/{user_a_id}?tail=1",
        headers=auth_b,
    )
    assert messages.status_code == 200
    items = messages.get_json()["items"]
    assert any("你好 Bob" in item.get("content", "") for item in items)


def test_friend_request_reject(client, auth_a, auth_b, user_b):
    profile_b = client.get("/api/me/profile", headers=auth_b).get_json()
    user_b_id = profile_b["id"]

    request_resp = client.post(
        "/api/social/friends/request",
        json={"user_id": user_b_id},
        headers=auth_a,
    )
    request_id = request_resp.get_json()["id"]

    reject = client.post(
        f"/api/social/friends/requests/{request_id}/reject",
        headers=auth_b,
    )
    assert reject.status_code == 200
    assert reject.get_json()["status"] == "rejected"
