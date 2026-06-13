def test_root_ok(client):
    response = client.get("/")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["status"] == "ok"
    assert payload["service"] == "njuatlas-backend"


def test_health_endpoints(client):
    for path in ("/health", "/api/health"):
        response = client.get(path)
        assert response.status_code == 200
        payload = response.get_json()
        assert payload["status"] == "ok"
        assert payload["service"] == "njuatlas-backend"
        assert "realtime" in payload
