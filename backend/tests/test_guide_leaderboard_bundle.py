def test_guide_leaderboard_bundle(client):
    response = client.get(
        "/api/places/guide-leaderboard-bundle",
        query_string={"campus": "鼓楼", "categories": "美食,咖啡饮品"},
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["campus"] == "鼓楼"
    assert "美食" in payload["boards"]
    assert "咖啡饮品" in payload["boards"]
    assert isinstance(payload["boards"]["美食"], list)


def test_guide_leaderboard_bundle_rejects_all_campus(client):
    response = client.get(
        "/api/places/guide-leaderboard-bundle",
        query_string={"campus": "all", "categories": "美食"},
    )
    assert response.status_code == 400
