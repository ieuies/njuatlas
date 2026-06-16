"""与前端 guide 关键词搜索对齐的高德 POI 多源检索。"""

from math import asin, cos, radians, sin, sqrt

from app.services.amap import inputtips, search_places
from app.services.guide import GUIDE_MAX_DISTANCE_M, is_excluded_guide_poi_name, is_food_amap_poi, is_food_amap_poi

KEYWORD_SEARCH_RADIUS = 10000
KEYWORD_PAGE_SIZE = 25


def expand_keyword_search_terms(keywords):
    """完整店名高德未必收录，补充品牌前缀/菜名后缀检索词。"""
    expanded = []
    seen = set()

    def _add(kw):
        kw = (kw or "").strip()
        if len(kw) < 2:
            return
        key = kw.lower()
        if key in seen:
            return
        seen.add(key)
        expanded.append(kw)

    for kw in keywords or []:
        _add(kw)
        if len(kw) >= 4:
            _add(kw[:2])
        if len(kw) >= 5:
            rest = kw[2:]
            if len(rest) >= 2:
                _add(rest)
    return expanded[:6]


def parse_location(loc):
    """解析 \"lng,lat\" 字符串，供帖子距离排序等模块复用。"""
    return _parse_loc(loc)


def distance_m(origin_lng, origin_lat, poi_loc):
    """两点间球面距离（米）。"""
    return _distance_m(origin_lng, origin_lat, poi_loc)


def _parse_loc(loc):
    if not loc or "," not in str(loc):
        return None, None
    try:
        lng_s, lat_s = str(loc).split(",", 1)
        return float(lng_s), float(lat_s)
    except (TypeError, ValueError):
        return None, None


def _distance_m(origin_lng, origin_lat, poi_loc):
    if origin_lng is None or not poi_loc:
        return None
    plng, plat = _parse_loc(poi_loc)
    if plng is None:
        return None
    rad = radians
    lng1, lat1, lng2, lat2 = map(rad, [origin_lng, origin_lat, plng, plat])
    dlng = lng2 - lng1
    dlat = lat2 - lat1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlng / 2) ** 2
    return int(6371000 * 2 * asin(sqrt(a)))


def _poi_dedupe_key(poi):
    name = str(poi.get("name") or "").strip().lower()
    loc = str(poi.get("location") or "").strip()
    addr = str(poi.get("address") or "").strip().lower()
    plng, plat = _parse_loc(loc)
    if name and plng is not None:
        return f"{name}|{round(plng, 4)},{round(plat, 4)}"
    if name and addr:
        return f"{name}|{addr}"
    poi_id = str(poi.get("id") or "").strip()
    if poi_id:
        return f"poi:{poi_id}"
    return name or poi_id


def _poi_richness(poi):
    score = 1 if poi.get("id") else 0
    biz = poi.get("biz_ext") or {}
    if isinstance(biz, dict) and (biz.get("rating") or biz.get("cost")):
        score += 2
    if poi.get("photos"):
        score += 1
    return score


def _merge_poi(existing, incoming):
    base = existing if _poi_richness(existing) >= _poi_richness(incoming) else incoming
    other = incoming if base is existing else existing
    merged = dict(base)
    if not merged.get("id") and other.get("id"):
        merged["id"] = other.get("id")
    if not merged.get("address") and other.get("address"):
        merged["address"] = other.get("address")
    if not merged.get("type") and other.get("type"):
        merged["type"] = other.get("type")
    base_biz = merged.get("biz_ext") if isinstance(merged.get("biz_ext"), dict) else {}
    other_biz = other.get("biz_ext") if isinstance(other.get("biz_ext"), dict) else {}
    merged["biz_ext"] = {
        **other_biz,
        **{k: v for k, v in base_biz.items() if v},
    }
    if not merged.get("photos") and other.get("photos"):
        merged["photos"] = other.get("photos")
    return merged


def _normalize_tip_location(raw_location):
    if not raw_location:
        return ""
    if isinstance(raw_location, dict):
        lng = str(raw_location.get("lng", "")).strip()
        lat = str(raw_location.get("lat", "")).strip()
        if not lng or not lat:
            return ""
        return f"{lng},{lat}"
    value = str(raw_location).strip()
    if not value or "," not in value:
        return ""
    return value


def _collect_pois(pois, seen, merged, origin_lng, origin_lat, max_distance_m):
    for poi in pois or []:
        name = str(poi.get("name") or "").strip()
        if not name or is_excluded_guide_poi_name(name) or not is_food_amap_poi(poi):
            continue
        if origin_lng is not None:
            dist = _distance_m(origin_lng, origin_lat, poi.get("location"))
            if dist is None or dist > max_distance_m:
                continue
        key = _poi_dedupe_key(poi)
        if not key:
            continue
        if key in seen:
            idx = seen[key]
            merged[idx] = _merge_poi(merged[idx], poi)
            continue
        seen[key] = len(merged)
        merged.append(poi)


def _search_term_pois(term, city, location, origin_lng, origin_lat, max_distance_m, seen, merged):
    term = (term or "").strip()
    if len(term) < 2:
        return

    try:
        tips_data = inputtips(term, city=city, location=location)
        for tip in tips_data.get("tips") or []:
            tip_name = str(tip.get("name") or "").strip()
            if not tip_name or is_excluded_guide_poi_name(tip_name):
                continue
            tip_poi = {
                "name": tip_name,
                "location": _normalize_tip_location(tip.get("location")),
                "address": tip.get("address") or tip.get("district") or "",
                "type": tip.get("typecode") or tip.get("type") or "",
                "biz_ext": {},
            }
            if not is_food_amap_poi(tip_poi):
                continue
            tip_loc = _normalize_tip_location(tip.get("location"))
            if tip_loc:
                _collect_pois(
                    [{
                        "name": tip_name,
                        "location": tip_loc,
                        "address": tip.get("address") or tip.get("district") or "",
                        "type": "",
                        "biz_ext": {},
                    }],
                    seen,
                    merged,
                    origin_lng,
                    origin_lat,
                    max_distance_m,
                )
            else:
                text = search_places(
                    tip_name,
                    city=city,
                    page=1,
                    page_size=5,
                    types="050000",
                    sortrule="weight",
                )
                if str(text.get("status")) == "1":
                    _collect_pois(
                        text.get("pois"),
                        seen,
                        merged,
                        origin_lng,
                        origin_lat,
                        max_distance_m,
                    )
    except Exception:
        pass

    if location:
        try:
            around = search_places(
                term,
                city=city,
                location=location,
                page=1,
                page_size=KEYWORD_PAGE_SIZE,
                radius=KEYWORD_SEARCH_RADIUS,
                types="050000",
                sortrule="distance",
            )
            if str(around.get("status")) == "1":
                _collect_pois(
                    around.get("pois"),
                    seen,
                    merged,
                    origin_lng,
                    origin_lat,
                    max_distance_m,
                )
        except Exception:
            pass

    try:
        city_wide = search_places(
            term,
            city=city,
            page=1,
            page_size=KEYWORD_PAGE_SIZE,
            types=None,
            sortrule="weight",
        )
        if str(city_wide.get("status")) == "1":
            _collect_pois(
                city_wide.get("pois"),
                seen,
                merged,
                origin_lng,
                origin_lat,
                max_distance_m,
            )
    except Exception:
        pass


def collect_keyword_search_pois(keyword, city="南京", location=None, max_distance_m=None, extra_terms=None):
    """对齐 js/api.js `_searchGuidePlacesByKeyword`：inputtips + 无分类周边 + 全市文本。"""
    keyword = (keyword or "").strip()
    if not keyword:
        return []

    max_distance_m = max_distance_m or GUIDE_MAX_DISTANCE_M
    origin_lng = origin_lat = None
    if location:
        origin_lng, origin_lat = _parse_loc(location)

    terms = []
    for term in [keyword, *(extra_terms or [])]:
        term = (term or "").strip()
        if term and term not in terms:
            terms.append(term)
    for term in expand_keyword_search_terms(terms):
        if term not in terms:
            terms.append(term)

    seen = {}
    merged = []
    for term in terms:
        _search_term_pois(term, city, location, origin_lng, origin_lat, max_distance_m, seen, merged)
    return merged


def sort_pois_by_keyword(pois, keyword):
    kw = (keyword or "").strip().lower()
    if not kw:
        return list(pois or [])

    def score(poi):
        name = str(poi.get("name") or "").lower()
        s = 0
        if name == kw:
            s += 500
        if kw in name:
            s += 200
        if name.startswith(kw):
            s += 80
        for ch in kw:
            if ch in name:
                s += 2
        return s

    return sorted(pois or [], key=score, reverse=True)
