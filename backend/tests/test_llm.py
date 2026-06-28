def test_chat_recommend_requires_auth(client):
    response = client.post("/api/llm/chat_recommend", json={"message": "你好"})
    assert response.status_code == 401


def test_chat_recommend_with_mocked_llm(client, auth_a, monkeypatch):
    monkeypatch.setattr(
        "app.routes.llm_routes.chat_with_llm",
        lambda messages, **kwargs: "你好，我是小鲸灵！",
    )

    response = client.post(
        "/api/llm/chat_recommend",
        json={"message": "你好，今天天气怎么样"},
        headers=auth_a,
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["reply"]
    assert "session_id" in payload
    assert isinstance(payload.get("candidates"), list)
