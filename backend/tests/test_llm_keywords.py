from app.services.ai_recommend import (
    is_food_intent,
    needs_food_clarification,
    resolve_category,
    resolve_campus,
    resolve_guide_keyword,
    sanitize_llm_reply,
)
from app.services.guide import AI_DINING_CATEGORIES, GUIDE_CATEGORY_CONFIG, is_excluded_guide_poi_name


def test_ai_only_fixed_dining_categories():
    assert AI_DINING_CATEGORIES == ("美食", "咖啡饮品")
    for cat in AI_DINING_CATEGORIES:
        assert cat in GUIDE_CATEGORY_CONFIG
        assert GUIDE_CATEGORY_CONFIG[cat]["types"]


def test_generic_queries_no_guide_keyword():
    for msg in (
        "有没有安静的餐厅",
        "有没有便宜又好吃的餐厅",
        "有没有评分高的餐厅",
        "推荐一家烧烤餐厅",
    ):
        assert is_food_intent(msg)
        assert resolve_guide_keyword(msg) in ("", "烧烤")  # 仅烧烤有品类词


def test_quiet_and_rating_keywords_empty():
    assert resolve_guide_keyword("有没有安静的餐厅") == ""
    assert resolve_guide_keyword("有没有评分高的餐厅") == ""


def test_barbecue_uses_cuisine_keyword():
    assert resolve_guide_keyword("推荐一家烧烤餐厅") == "烧烤"


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


def test_follow_up_after_clarification_skips_again():
    history = [{"role": "assistant", "content": "你想吃哪一类？面馆火锅还是咖啡？"}]
    assert not needs_food_clarification("火锅", history=history)


def test_tobacco_shop_excluded_by_name():
    assert is_excluded_guide_poi_name("孙氏烟酒(高楼门53号店)")


def test_solo_dining_query_no_keyword_garbage():
    msg = "我想去一个人吃饭，有推荐吗"
    assert is_food_intent(msg)
    assert resolve_guide_keyword(msg) == ""
    assert needs_food_clarification(msg)


def test_sanitize_strips_template_reply():
    bad = "帮你查到了和「我想 一个人 饭，」相关的店：\n老马牛肉面\n详细信息可以看下面卡片。"
    clean = sanitize_llm_reply(bad, needs_clarification=True)
    assert "帮你查到了" not in clean
    assert "我想 一个人" not in clean
