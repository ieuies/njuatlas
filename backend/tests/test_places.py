def test_hot_areas(client):
    response = client.get("/api/places/hot_areas")
    assert response.status_code == 200
    payload = response.get_json()
    assert "xianlin" in payload
    assert payload["xianlin"]["name"]


def test_guide_config(client):
    response = client.get("/api/places/guide-config")
    assert response.status_code == 200
    payload = response.get_json()
    assert "campuses" in payload
    assert "categories" in payload


def test_categories(client):
    response = client.get("/api/places/categories")
    assert response.status_code == 200
    categories = response.get_json()["categories"]
    assert categories
    assert categories[0]["children"]


def test_search_with_mocked_amap(client, monkeypatch):
    monkeypatch.setattr(
        "app.routes.places.search_places",
        lambda *args, **kwargs: {
            "status": "1",
            "pois": [
                {
                    "id": "B001",
                    "name": "测试餐厅",
                    "address": "南京市鼓楼区",
                    "location": "118.78,32.05",
                    "type": "050100",
                }
            ],
        },
    )
    response = client.get("/api/places/search?keyword=餐厅&city=南京")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["pois"][0]["name"] == "测试餐厅"


def test_guide_like_ensure_place(client, auth_a):
    response = client.post(
        "/api/places/guide/like",
        json={
            "campus": "鼓楼",
            "category": "美食",
            "item": {
                "name": "测试小馆",
                "address": "汉口路",
                "location": "118.779562,32.055153",
                "poi_id": "TEST-POI-001",
            },
            "liked": True,
        },
        headers=auth_a,
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["liked"] is True
    assert payload["place_id"]
