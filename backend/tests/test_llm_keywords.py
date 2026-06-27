from app.services.ai_recommend import (
    classify_guide_intent,
    clarification_chips_for,
    detect_mall_keyword,
    is_food_intent,
    needs_food_clarification,
    needs_guide_clarification,
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


def test_mall_keyword_detection():
    assert detect_mall_keyword("德基有什么吃的") == "德基"
    assert detect_mall_keyword("艾尚天地附近咖啡") == "艾尚天地"
    assert detect_mall_keyword("仙林有什么景点") is None


def test_resolve_mall_anchor_fallback(monkeypatch):
    monkeypatch.setattr(
        "app.services.ai_recommend.inputtips",
        lambda keyword, city="南京": {"tips": []},
    )
    monkeypatch.setattr(
        "app.services.ai_recommend.search_places",
        lambda keyword, **kwargs: {
            "status": "1",
            "pois": [{"name": "德基广场", "location": "118.78,32.04"}],
        },
    )
    anchor = resolve_mall_anchor("德基有什么吃的")
    assert anchor is not None
    assert anchor["name"] == "德基广场"
    assert "," in anchor["location"]


def test_fetch_guide_items_merges_db_when_amap_empty(monkeypatch):
    from app.services.ai_recommend import _fetch_guide_items

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

    items = _fetch_guide_items(
        mode="campus",
        campus="鼓楼",
        category="景点公园",
        keyword="",
        user_id=None,
        mall_location=None,
    )
    assert len(items) == 1
    assert "德基艺术博物馆" in items[0]["name"]
