"""chat_recommend 集成测试：确保无旧版「帮你查到了」模板与非餐饮 POI。"""

def _fake_dining_items():
    return [
        {
            "name": "老马牛肉面(上海路店)",
            "poi_id": "poi-1",
            "rating": "4.5",
            "price": "22",
            "distance_m": 226,
            "address": "上海路",
            "location": "118.78,32.05",
            "type": "清真菜馆",
        },
        {
            "name": "春水塘土菜馆(汉口路店)",
            "poi_id": "poi-2",
            "rating": "4.5",
            "price": "42",
            "distance_m": 304,
            "address": "汉口路",
            "location": "118.77,32.06",
            "type": "中餐厅",
        },
    ]


def _patch_dining_search(monkeypatch):
    def _search(campus, category, keyword="", user_id=None, page=1):
        return {"items": _fake_dining_items(), "error": False}

    monkeypatch.setattr(
        "app.services.ai_recommend.search_ai_dining_places",
        _search,
    )
    monkeypatch.setattr(
        "app.services.ai_recommend.fetch_ai_dining_seed",
        lambda campus, category: [],
    )
    monkeypatch.setattr(
        "app.services.ai_recommend.enrich_guide_items",
        lambda items, **kwargs: items,
    )
    monkeypatch.setattr(
        "app.services.ai_recommend.dedupe_guide_items",
        lambda items: items,
    )


def test_cheap_tasty_restaurant_no_template_reply(client, auth_a, monkeypatch):
    _patch_dining_search(monkeypatch)
    monkeypatch.setattr(
        "app.routes.llm_routes.chat_with_llm",
        lambda messages, **kwargs: "便宜又好吃可以看看老马牛肉面，人均二十出头，评分也不错。",
    )

    response = client.post(
        "/api/llm/chat_recommend",
        json={"message": "有没有便宜又好吃的餐厅"},
        headers=auth_a,
    )
    assert response.status_code == 200
    payload = response.get_json()
    reply = payload.get("reply") or ""
    assert "帮你查到了" not in reply
    assert "没 便宜又" not in reply
    assert "相关的店" not in reply
    assert "详细信息可以看下面卡片" not in reply

    names = [c.get("name") for c in payload.get("candidates") or []]
    assert "世界贸易中心" not in names
    assert any("牛肉面" in n for n in names)


def test_broad_nearby_query_clarifies_without_candidates(client, auth_a, monkeypatch):
    _patch_dining_search(monkeypatch)
    monkeypatch.setattr(
        "app.routes.llm_routes.chat_with_llm",
        lambda messages, **kwargs: "鼓楼一带吃的不少，你更想吃面馆、火锅还是咖啡轻食？",
    )

    response = client.post(
        "/api/llm/chat_recommend",
        json={"message": "南大南门附近有什么吃的"},
        headers=auth_a,
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload.get("candidates") == []
    assert "帮你查到了" not in (payload.get("reply") or "")


def test_sanitize_strips_llm_template_if_model_slips(client, auth_a, monkeypatch):
    _patch_dining_search(monkeypatch)
    monkeypatch.setattr(
        "app.routes.llm_routes.chat_with_llm",
        lambda messages, **kwargs: (
            "帮你查到了和「没 便宜又」相关的店：\n世界贸易中心\n详细信息可以看下面卡片。"
        ),
    )

    response = client.post(
        "/api/llm/chat_recommend",
        json={"message": "有没有便宜又好吃的餐厅"},
        headers=auth_a,
    )
    assert response.status_code == 200
    reply = response.get_json().get("reply") or ""
    assert "帮你查到了" not in reply
    assert "世界贸易中心" not in reply
