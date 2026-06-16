from app.services.guide import is_food_amap_poi, is_excluded_guide_poi_name


def test_world_trade_center_not_food_poi():
    poi = {"name": "世界贸易中心", "type": "120201;商务住宅"}
    assert not is_food_amap_poi(poi)
    assert is_excluded_guide_poi_name("世界贸易中心")


def test_noodle_shop_is_food_poi():
    poi = {"name": "一家人面馆(三条巷店)", "type": "050100;中餐厅"}
    assert is_food_amap_poi(poi)


def test_handicraft_shop_excluded():
    poi = {"name": "一家有猫的手工店陶艺·银戒指·石膏娃娃", "type": "060000"}
    assert not is_food_amap_poi(poi)


def test_barbecue_restaurant_name_without_type():
    poi = {"name": "老李烧烤", "type": ""}
    assert is_food_amap_poi(poi)
