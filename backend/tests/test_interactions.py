def test_add_place_review_and_like(client, auth_a):
    place = client.post(
        "/api/place",
        json={
            "name": "测试咖啡馆",
            "address": "南京大学鼓楼校区附近",
            "location": "118.779562,32.055153",
            "poi_id": "TEST-POI-001",
            "category": "050500",
        },
        headers=auth_a,
    )
    assert place.status_code == 201
    place_id = place.get_json()["id"]

    duplicate = client.post(
        "/api/place",
        json={"name": "重复", "poi_id": "TEST-POI-001"},
        headers=auth_a,
    )
    assert duplicate.status_code == 200
    assert duplicate.get_json()["id"] == place_id

    review = client.post(
        "/api/review",
        json={"place_id": place_id, "content": "环境不错", "rating": 5},
        headers=auth_a,
    )
    assert review.status_code == 201

    like = client.post("/api/like", json={"place_id": place_id}, headers=auth_a)
    assert like.status_code == 200
    assert like.get_json()["liked"] is True
