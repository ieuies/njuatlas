from app.services.ai_recommend import (
    _effective_mall_search_message,
    _fetch_campus_branch,
    _fetch_mall_branch,
    _resolve_mall_branch,
    _resolve_mall_shop_category,
    _score_mall_poi,
    classify_guide_intent,
    clarification_chips_for,
    extract_location_queries,
    is_mall_amap_poi,
    is_food_intent,
    needs_food_clarification,
    needs_guide_clarification,
    prepare_chat_recommend_context,
    resolve_category,
    resolve_campus,
    resolve_guide_keyword,
    resolve_mall_anchor,
    sanitize_llm_reply,
)
from app.services.guide import AI_GUIDE_CATEGORIES, GUIDE_CATEGORY_CONFIG, is_excluded_guide_poi_name


def test_ai_supports_all_guide_categories():
    assert len(AI_GUIDE_CATEGORIES) == len(GUIDE_CATEGORY_CONFIG)
    for cat in AI_GUIDE_CATEGORIES:
        assert cat in GUIDE_CATEGORY_CONFIG
        assert GUIDE_CATEGORY_CONFIG[cat]["types"]


def test_classify_guide_intent_categories():
    assert classify_guide_intent("仙林有什么景点") == "景点公园"
    assert classify_guide_intent("鼓楼附近电影院") == "休闲娱乐"
    assert classify_guide_intent("附近健身房推荐") == "运动健身"
    assert classify_guide_intent("新街口逛街") == "购物商圈"
    assert classify_guide_intent("今天天气真好") is None


def test_generic_queries_no_guide_keyword():
    for msg in (
        "有没有安静的餐厅",
        "有没有便宜又好吃的餐厅",
        "有没有评分高的餐厅",
        "推荐一家烧烤餐厅",
    ):
        assert is_food_intent(msg)
        assert resolve_guide_keyword(msg, "美食") in ("", "烧烤")


def test_quiet_and_rating_keywords_empty():
    assert resolve_guide_keyword("有没有安静的餐厅", "美食") == ""
    assert resolve_guide_keyword("有没有评分高的餐厅", "美食") == ""


def test_barbecue_uses_cuisine_keyword():
    assert resolve_guide_keyword("推荐一家烧烤餐厅", "美食") == "烧烤"


def test_coffee_uses_drink_category():
    assert resolve_category("想喝咖啡") == "咖啡饮品"
    assert resolve_category("想吃火锅") == "美食"


def test_campus_resolution():
    assert resolve_campus("仙林校区附近吃什么") == "仙林"
    assert resolve_campus("鼓楼有什么好吃的") == "鼓楼"
    assert resolve_campus("南大南门附近有什么吃的") == "鼓楼"


def test_broad_nearby_query_needs_clarification():
    msg = "南大南门附近有什么吃的"
    assert is_food_intent(msg)
    assert needs_food_clarification(msg)
    assert not needs_food_clarification("推荐一家烧烤餐厅")
    assert not needs_food_clarification("想喝咖啡")
    assert needs_guide_clarification("鼓楼有什么好玩的", "休闲娱乐")


def test_clarification_chips_by_category():
    assert "火锅" in clarification_chips_for("美食")
    assert "电影" in clarification_chips_for("休闲娱乐")


def test_follow_up_after_clarification_skips_again():
    history = [{"role": "assistant", "content": "你想吃哪一类？面馆火锅还是咖啡？"}]
    assert not needs_food_clarification("火锅", history=history)


def test_tobacco_shop_excluded_by_name():
    assert is_excluded_guide_poi_name("孙氏烟酒(高楼门53号店)")


def test_mall_shop_mode_skips_shopping_center_keyword():
    assert is_excluded_guide_poi_name("某某购物中心", skip_keywords=("购物中心",)) is False
    assert is_excluded_guide_poi_name("某某购物中心") is True


def test_solo_dining_query_no_keyword_garbage():
    msg = "我想去一个人吃饭，有推荐吗"
    assert is_food_intent(msg)
    assert resolve_guide_keyword(msg, "美食") == ""
    assert needs_food_clarification(msg)


def test_sanitize_strips_template_reply():
    bad = "帮你查到了和「我想 一个人 饭，」相关的店：\n老马牛肉面\n详细信息可以看下面卡片。"
    clean = sanitize_llm_reply(bad, needs_clarification=True)
    assert "帮你查到了" not in clean
    assert "我想 一个人" not in clean


def test_extract_location_queries():
    assert extract_location_queries("德基有什么吃的") == ["德基"]
    assert extract_location_queries("金鹰里有什么吃的吗") == ["金鹰", "金鹰里"]
    assert extract_location_queries("艾尚天地附近咖啡") == ["艾尚天地"]
    assert extract_location_queries("仙林有什么景点") == []
    assert extract_location_queries("吾悦广场有什么吃的") == ["吾悦广场"]
    assert extract_location_queries("建邺万达附近火锅") == ["建邺万达"]


def test_is_mall_amap_poi():
    assert is_mall_amap_poi({"type": "060100"}) is True
    assert is_mall_amap_poi({"type": "120201"}) is False


def test_score_mall_poi_prefers_shopping_center_type():
    mall_poi = {"name": "德基广场", "type": "060100", "distance": "100"}
    office_poi = {"name": "德基写字楼", "type": "120201", "distance": "50"}
    assert _score_mall_poi(mall_poi, "德基") > 0
    assert _score_mall_poi(office_poi, "德基") < 0


def test_resolve_mall_shop_category():
    assert _resolve_mall_shop_category("德基有什么吃的", "购物商圈") == "美食"
    assert _resolve_mall_shop_category("德基有什么好玩的", "购物商圈") == "休闲娱乐"
    assert _resolve_mall_shop_category("德基想喝咖啡", "购物商圈") == "咖啡饮品"
    assert _resolve_mall_shop_category("德基逛街", "购物商圈") == "购物商圈"


def test_resolve_mall_anchor_fallback(monkeypatch):
    monkeypatch.setattr(
        "app.services.ai_recommend.inputtips",
        lambda keyword, city="南京": {"tips": []},
    )
    monkeypatch.setattr(
        "app.services.ai_recommend.search_places",
        lambda keyword, **kwargs: {
            "status": "1",
            "pois": [
                {
                    "id": "poi-deji",
                    "name": "德基广场",
                    "location": "118.78,32.04",
                    "type": "060100",
                },
            ],
        },
    )
    anchor = resolve_mall_anchor("德基有什么吃的")
    assert anchor is not None
    assert anchor["name"] == "德基广场"
    assert "," in anchor["location"]
    assert anchor.get("poi_id") == "poi-deji"


def test_resolve_mall_anchor_known_fallback_when_amap_empty(monkeypatch):
    monkeypatch.setattr(
        "app.services.ai_recommend.inputtips",
        lambda keyword, city="南京": {"tips": []},
    )
    monkeypatch.setattr(
        "app.services.ai_recommend.search_places",
        lambda keyword, **kwargs: {"status": "0", "info": "USER_DAILY_QUERY_OVER_LIMIT", "pois": []},
    )
    anchor = resolve_mall_anchor("德基有什么吃的")
    assert anchor is not None
    assert anchor["name"] == "德基广场"
    assert anchor.get("poi_id") == "fallback-deji"


def test_needs_guide_clarification_skips_when_location_present():
    assert needs_guide_clarification("德基有什么吃的", "美食") is False
    assert needs_guide_clarification("金鹰里有什么吃的", "美食") is False
    assert needs_guide_clarification("有什么好吃的", "美食") is True


def test_resolve_mall_anchor_scores_multiple_pois(monkeypatch):
    monkeypatch.setattr(
        "app.services.ai_recommend.inputtips",
        lambda keyword, city="南京": {"tips": []},
    )

    def _search(keyword, **kwargs):
        return {
            "status": "1",
            "pois": [
                {
                    "id": "poi-office",
                    "name": "德基写字楼",
                    "location": "118.78,32.04",
                    "type": "120201",
                },
                {
                    "id": "poi-mall",
                    "name": "德基广场",
                    "location": "118.78,32.04",
                    "type": "060100",
                },
            ],
        }

    monkeypatch.setattr("app.services.ai_recommend.search_places", _search)
    anchor = resolve_mall_anchor("德基有什么吃的")
    assert anchor["name"] == "德基广场"
    assert anchor["poi_id"] == "poi-mall"


def test_resolve_mall_branch(monkeypatch):
    monkeypatch.setattr(
        "app.services.ai_recommend.resolve_mall_anchor",
        lambda message, city="南京": {
            "name": "德基广场",
            "location": "118.78,32.04",
            "keyword": "德基",
            "poi_id": "poi-deji",
        },
    )
    branch = _resolve_mall_branch("德基有什么吃的", "购物商圈", city="南京")
    assert branch is not None
    assert branch["anchor"]["name"] == "德基广场"
    assert branch["category"] == "美食"


def test_mall_search_message_inherits_from_clarification_history():
    history = [
        {"role": "user", "content": "金鹰里有什么吃的吗"},
        {"role": "assistant", "content": "你想吃哪一类？火锅还是烧烤？"},
    ]
    merged = _effective_mall_search_message("火锅", history)
    assert "金鹰" in merged
    assert "火锅" in merged


def test_fetch_campus_branch_merges_db_when_amap_empty(monkeypatch):
    db_item = {
        "name": "德基艺术博物馆(德基广场二期店)",
        "poi_id": "poi-museum",
        "rating": "4.8",
        "price": "",
        "distance_m": 1200,
        "address": "中山路18号",
        "location": "118.78,32.04",
        "type": "博物馆",
        "like_count": 3,
        "place_id": 42,
    }

    monkeypatch.setattr(
        "app.services.ai_recommend.search_ai_guide_places",
        lambda campus, category, keyword="", user_id=None, page=1: {"items": [], "error": True},
    )
    monkeypatch.setattr(
        "app.services.ai_recommend.fetch_ai_guide_seed",
        lambda campus, category: [],
    )
    monkeypatch.setattr(
        "app.services.ai_recommend.fetch_db_leaderboard_candidates",
        lambda campus, category: [db_item] if category == "景点公园" else [],
    )
    monkeypatch.setattr(
        "app.services.ai_recommend.enrich_guide_items",
        lambda items, **kwargs: items,
    )

    items = _fetch_campus_branch(
        campus="鼓楼",
        category="景点公园",
        keyword="",
        user_id=None,
    )
    assert len(items) == 1
    assert "德基艺术博物馆" in items[0]["name"]


def test_fetch_mall_branch_excludes_anchor(monkeypatch):
    captured = {}

    def _near(location, category, keyword="", campus="鼓楼", user_id=None, **kwargs):
        captured.update(kwargs)
        return {
            "items": [
                {
                    "name": "某餐厅",
                    "poi_id": "poi-shop",
                    "rating": "4.5",
                    "price": "50",
                    "distance_m": 120,
                    "address": "中山路",
                    "location": "118.78,32.04",
                    "type": "中餐厅",
                },
            ],
        }

    monkeypatch.setattr("app.services.ai_recommend.search_guide_places_near", _near)
    monkeypatch.setattr(
        "app.services.ai_recommend.enrich_guide_items",
        lambda items, **kwargs: items,
    )

    anchor = {
        "name": "德基广场",
        "location": "118.78,32.04",
        "poi_id": "poi-deji",
    }
    items = _fetch_mall_branch(
        anchor=anchor,
        campus="鼓楼",
        category="美食",
        keyword="",
        user_id=None,
    )
    assert len(items) == 1
    assert captured.get("mall_shop_mode") is True
    assert captured.get("exclude_anchor_poi_id") == "poi-deji"
    assert captured.get("exclude_anchor_name") == "德基广场"
    assert captured.get("radius") == 800


def test_prepare_chat_recommend_mall_no_campus_fallback(monkeypatch):
    monkeypatch.setattr(
        "app.services.ai_recommend._resolve_mall_branch",
        lambda message, category, history=None, city="南京": {
            "anchor": {
                "name": "德基广场",
                "location": "118.78,32.04",
                "poi_id": "poi-deji",
            },
            "category": "美食",
        },
    )
    monkeypatch.setattr(
        "app.services.ai_recommend._fetch_mall_branch",
        lambda **kwargs: [],
    )
    campus_called = {"v": False}

    def _campus(**kwargs):
        campus_called["v"] = True
        return []

    monkeypatch.setattr("app.services.ai_recommend._fetch_campus_branch", _campus)

    ctx = prepare_chat_recommend_context("德基附近火锅推荐")
    assert ctx["mode"] == "mall_anchor"
    assert ctx["mall_name"] == "德基广场"
    assert campus_called["v"] is False
    assert "请勿推荐商场外" in ctx["candidates_text"]
