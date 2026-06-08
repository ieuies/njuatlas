from flask import Blueprint, current_app, g, jsonify, request

from app import db
from app.auth_utils import jwt_required
from app.errors import error_response
from app.logging_utils import log_event
from app.models import ConversationMessage, Favorite, Like, Place, Review
from app.rate_limit import limiter
from app.services.amap import search_places
from app.services.llm import chat_with_llm
from app.validators import clean_string, get_json_body, positive_int, validate_session_id


llm_bp = Blueprint("llm", __name__, url_prefix="/api/llm")


@llm_bp.route("/recommend_slogan", methods=["GET"])
@limiter.limit("20 per minute")
def recommend_slogan():
    place_id = positive_int(request.args.get("place_id"), "place_id")
    place = Place.query.get(place_id)
    if not place:
        return error_response("场所不存在", 404, code="place_not_found")

    reviews = Review.query.filter_by(place_id=place_id).limit(3).all()
    reviews_text = ""
    if reviews:
        reviews_text = "已有食客评价：" + "；".join([r.content for r in reviews])

    messages = [
        {
            "role": "system",
            "content": (
                "用一句不超过30字的口语评价描述这家店。"
                "语气自然，像朋友随口说的一样。"
                "禁止使用 Markdown 语法，只输出纯文本。"
                "不要用'这家店'、'它'等代词。"
            ),
        },
        {
            "role": "user",
            "content": f"店名：{place.name}\n地址：{place.address or '未知'}\n{reviews_text}\n\n用一句话评价这家店。",
        },
    ]

    try:
        slogan = chat_with_llm(messages, temperature=0.7, max_tokens=60)
        return jsonify({"place_id": place_id, "slogan": slogan})
    except Exception as exc:
        log_event(current_app.logger, "slogan_generation_failed", level="error", place_id=place_id, error=str(exc))
        return error_response("AI 生成失败", 502, code="llm_error")


def _load_conversation_history(user_id, session_id):
    limit = current_app.config["CONVERSATION_HISTORY_LIMIT"]
    rows = (
        ConversationMessage.query
        .filter_by(user_id=user_id, session_id=session_id)
        .order_by(ConversationMessage.created_at.desc(), ConversationMessage.id.desc())
        .limit(limit)
        .all()
    )
    rows.reverse()
    return [{"role": row.role, "content": row.content} for row in rows]


def _save_conversation_message(user_id, session_id, role, content):
    message = ConversationMessage(
        user_id=user_id,
        session_id=session_id,
        role=role,
        content=content,
    )
    db.session.add(message)
    return message


@llm_bp.route("/chat_recommend", methods=["POST"])
@jwt_required
@limiter.limit("10 per minute")
def chat_recommend():
    data = get_json_body(request)
    user_message = clean_string(data.get("message"), "message", required=True, max_length=500)
    session_id = validate_session_id(data.get("session_id")) or ConversationMessage.new_session_id()
    city = clean_string(data.get("city", "南京"), "city", required=True, max_length=50)

    user_id = g.current_user_id
    history = _load_conversation_history(user_id, session_id)

    liked = Like.query.filter_by(user_id=user_id).limit(10).all()
    favorited = Favorite.query.filter_by(user_id=user_id).limit(10).all()

    place_names = set()
    for item in liked:
        place_names.add(item.place.name)
    for item in favorited:
        place_names.add(item.place.name)

    preference_text = ""
    if place_names:
        preference_text = "这位用户喜欢的场所有：" + "、".join(list(place_names)[:5]) + "。"

    # 意图判断：只有用户明确在找餐厅时才去高德搜索
    food_keywords = [
        "吃", "饭", "餐厅", "美食", "推荐", "好吃", "饿了", "夜宵", "早餐",
        "午餐", "晚餐", "川菜", "湘菜", "火锅", "烧烤", "咖啡", "奶茶",
        "外卖", "堂食", "食堂", "哪家", "哪里", "什么店", "有啥", "有没有",
        "菜单", "点菜", "请客", "聚餐", "约会", "小吃", "甜点", "面包",
        "饺子", "面", "饭馆", "菜馆", "好喝",
        "附近", "周边", "旁边", "一带", "附近有", "去吃点",
        "去吃", "吃的", "吃东西", "吃的啥", "吃啥",
        "有什么好吃的", "有什么吃的", "有推荐的",
    ]
    is_food_request = any(kw in user_message.lower() for kw in food_keywords)

    # 兜底：消息中同时含有「推荐」+ 南大地点词也视为美食请求
    location_keywords = ["鼓楼", "仙林", "浦口", "南大", "校区", "南门", "北门", "汉口路", "珠江路"]
    if not is_food_request:
        if "推荐" in user_message.lower() and any(loc in user_message for loc in location_keywords):
            is_food_request = True

    # 细分餐饮类型映射：按关键词长度降序排列（越长越优先匹配）
    # 高德 POI 分类码参考：
    #   050000=餐饮, 050100=中餐厅, 050200=外国餐厅, 050300=快餐厅,
    #   050500=冷饮店, 050600=糕饼店, 050700=甜品店, 050800=茶餐厅,
    #   051000=咖啡厅, 051100=茶艺馆
    FOOD_TYPE_MAP = [
        # 饮品（优先长关键词）
        ("奶茶", "050500"),      # 冷饮店
        ("茶饮", "050500"),
        ("饮品", "050500"),
        ("咖啡", "051000"),      # 咖啡厅
        ("好喝", "050500"),      # 冷饮店（"什么好喝" → 饮品）
        # 甜点烘焙
        ("甜品", "050700"),      # 甜品店
        ("甜点", "050700"),
        ("面包", "050600"),      # 糕饼店
        ("蛋糕", "050600"),
        # 正餐细分
        ("火锅", "050100"),      # 中餐厅
        ("烧烤", "050100"),
        ("川菜", "050100"),
        ("湘菜", "050100"),
        ("粤菜", "050100"),
        ("麻辣烫", "050100"),
        ("麻辣", "050100"),
        ("饺子", "050100"),
        ("面馆", "050100"),
        ("面食", "050100"),
        ("饭馆", "050100"),
        ("菜馆", "050100"),
        ("日料", "050200"),      # 外国餐厅
        ("韩餐", "050200"),
        ("韩料", "050200"),
        ("西餐", "050200"),
        # 快餐小吃
        ("快餐", "050300"),      # 快餐厅
        ("小吃", "050300"),      # 快餐厅
        ("夜宵", "050300"),
        ("早餐", "050300"),
        ("午餐", "050300"),
        ("晚餐", "050300"),
        ("食堂", "050300"),
        # 茶餐厅
        ("茶餐厅", "050800"),    # 茶餐厅
        ("港式", "050800"),
    ]
    # 按关键词长度降序排列："茶餐厅" 比 "餐厅" 先匹配
    FOOD_TYPE_MAP.sort(key=lambda x: len(x[0]), reverse=True)

    def _resolve_food_type(message):
        """根据用户消息中的细分关键词，返回精确的高德 POI 类型码。
        未命中任何细分词时返回默认大类 '050000'。
        """
        msg_lower = message.lower()
        for keyword, type_code in FOOD_TYPE_MAP:
            if keyword in msg_lower:
                return type_code
        return "050000"

    def _resolve_search_keyword(message):
        """从用户消息中提取更适合高德搜索的地点关键词。
        例如 '鼓楼校区附近推荐一些' → '鼓楼'
        """
        area_keywords = sorted([
            ("汉口路", "汉口路"),
            ("珠江路", "珠江路"),
            ("鼓楼校区", "鼓楼"),
            ("仙林校区", "仙林"),
            ("鼓楼", "鼓楼"),
            ("仙林", "仙林"),
            ("浦口", "浦口"),
            ("南大", "南京大学"),
            ("新街口", "新街口"),
            ("夫子庙", "夫子庙"),
            ("南门", "南门"),
            ("北门", "北门"),
        ], key=lambda x: len(x[0]), reverse=True)
        for kw, replacement in area_keywords:
            if kw in message:
                return f"{replacement}"
        # 如果没有地名关键词，去掉无意义噪音词
        noise_words = [
            "附近", "周边", "一带", "推荐", "一些", "有什么", "有", "吗", "呢", "去",
            "帮我", "能不能", "可以", "给我", "啥", "什么", "哪里", "哪些",
            "好吃的", "吃的", "附近有", "推荐一下", "吃啥", "吃啥呢",
            "吃什么", "吃点啥", "去哪吃", "去哪", "去哪儿吃",
            "有好吃的", "有什么好吃的", "有啥好吃的",
            "有推荐的", "有推荐吗", "推荐吗",
            "想吃什么", "想吃啥", "想吃点",
            "叫外卖", "外卖", "附近的外卖",
            "今天", "今晚", "中午", "晚上",
            "吃", "喝", "是", "的", "了", "呀", "吧", "啊",
        ]
        clean = message
        for noise in sorted(noise_words, key=len, reverse=True):
            clean = clean.replace(noise, " ")
        clean = " ".join(clean.split()).strip()
        return clean if len(clean) >= 2 else message

    def _type_matches_search(message, name, type_str):
        """根据用户消息中的食物关键词、POI 名称和高德 type 字段，判断该 POI 是否匹配。
        返回 True 表示匹配（应保留），False 表示不匹配（应过滤掉）。
        """
        if not type_str:
            return True  # 没有 type 信息时不过滤，让 AI 自己判断
        if not message:
            return True
        type_lower = type_str.lower()
        msg_lower = message.lower()
        # 从 FOOD_TYPE_MAP 中找到匹配的关键词，再看 type 字段是否包含对应的分类名
        for keyword, type_code in FOOD_TYPE_MAP:
            if keyword in msg_lower:
                # 根据 type_code 推断高德 type 字符串中应该包含的中文分类名
                type_name_map = {
                    "050000": ["餐饮", "美食"],
                    "050100": ["中餐", "中餐厅", "川菜", "湘菜", "火锅", "麻辣", "面馆", "面食", "食堂"],
                    "050200": ["外国", "日料", "韩餐", "西餐"],
                    "050300": ["快餐", "小吃"],
                    "050500": ["冷饮", "茶饮", "奶茶", "饮品"],
                    "050600": ["糕饼", "面包", "蛋糕", "甜品"],
                    "050700": ["甜品", "甜点"],
                    "050800": ["茶餐厅", "港式"],
                    "051000": ["咖啡", "咖啡厅"],
                    "051100": ["茶馆", "茶艺"],
                }
                expected = type_name_map.get(type_code, [])
                # 如果 type 中包含任何期望的分类名，则匹配
                if expected and any(exp in type_lower for exp in expected):
                    pass  # type 匹配，继续检查 name
                else:
                    # 如果 type 不包含期望分类，但有名称兜底则放行（例如高德把面馆标成中餐厅）
                    # 同时检查名称是否包含关键词
                    name_keywords = {
                        "面馆": ["面", "面条", "拉面", "燃面", "拌面", "汤面"],
                        "面包": ["面包", "烘焙", "糕饼"],
                        "咖啡": ["咖啡", "coffee"],
                        "奶茶": ["奶茶", "茶饮", "茶", "饮品"],
                        "火锅": ["火锅", "焖锅"],
                        "饺子": ["饺子", "水饺"],
                        "川菜": ["川菜", "麻辣"],
                    }
                    name_lower = name.lower()
                    for nk, nvs in name_keywords.items():
                        if nk in msg_lower:
                            if any(nv in name_lower for nv in nvs):
                                return True  # 名称中包含关键词，放行
                    return False  # type 和 name 都不匹配，过滤
                # 继续往下检查，看 name 是否也匹配
                name_keywords = {
                    "面馆": ["面", "面条", "拉面", "燃面", "拌面", "汤面"],
                    "面包": ["面包", "烘焙", "糕饼"],
                }
                name_lower = name.lower()
                for nk, nvs in name_keywords.items():
                    if nk in msg_lower:
                        if any(nv in name_lower for nv in nvs):
                            return True  # 名称匹配
                        # type 通过了但名称不匹配 → 仍要检查
                        # 例如搜面馆，type 是中餐厅但名称叫"状元楼西苑餐厅" → 不应该通过
                        if not any(exp in type_lower for exp in expected):
                            return False
                return True
        return True  # 用户消息没有匹配到任何 FOOD_TYPE_MAP 关键词，不过滤

    candidates = []
    candidates_text = ""
    if is_food_request:
        user_location_raw = clean_string(data.get("location"), "location", max_length=50)

        # 硬过滤半径（米）
        MAX_DISTANCE_M = 5000

        # 预解析用户坐标
        user_lng = user_lat = None
        if user_location_raw:
            try:
                parts = user_location_raw.split(",")
                user_lng, user_lat = float(parts[0]), float(parts[1])
            except (ValueError, IndexError):
                pass

        # 根据用户消息中的细分关键词，选择精确的高德 POI 类型
        search_types = _resolve_food_type(user_message)
        search_keyword = _resolve_search_keyword(user_message)

        # 有定位 → 周边搜索（高德端 5km 过滤 + 更大页码确保候选充足）
        # 无定位 → 城市文本搜索（保持原有行为）
        if user_lng is not None and user_lat is not None:
            search_result = search_places(
                search_keyword,
                location=user_location_raw,
                radius=MAX_DISTANCE_M,
                page=1,
                page_size=25,
                types=search_types,
            )
            # 细分类型搜不到结果时，回退到餐饮大类再搜（避免冷门分类码在周边搜索为空）
            if search_types != "050000" and search_result.get("status") == "0" or (search_result.get("status") == "1" and not search_result.get("pois")):
                search_result = search_places(
                    search_keyword,
                    location=user_location_raw,
                    radius=MAX_DISTANCE_M,
                    page=1,
                    page_size=25,
                    types="050000",
                )
        else:
            search_result = search_places(
                search_keyword,
                city=city,
                page=1,
                page_size=10,
                types=search_types,
            )
            # 细分类型搜不到结果时，回退到餐饮大类再搜
            if search_types != "050000" and search_result.get("status") == "0" or (search_result.get("status") == "1" and not search_result.get("pois")):
                search_result = search_places(
                    search_keyword,
                    city=city,
                    page=1,
                    page_size=10,
                    types="050000",
                )

        if search_result.get("status") == "1":
            from math import radians, cos, sin, asin, sqrt

            def haversine(lng1, lat1, lng2, lat2):
                """球面距离，单位米。"""
                lng1, lat1, lng2, lat2 = map(radians, [lng1, lat1, lng2, lat2])
                dlng = lng2 - lng1
                dlat = lat2 - lat1
                a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlng / 2) ** 2
                return 2 * 6371000 * asin(sqrt(a))

            raw_candidates = []
            for poi in search_result.get("pois", []):
                dist_m = None
                poi_loc = poi.get("location", "")
                if user_lng is not None and poi_loc:
                    try:
                        plng, plat = poi_loc.split(",")
                        plng, plat = float(plng), float(plat)
                        dist_m = int(haversine(user_lng, user_lat, plng, plat))
                    except (ValueError, IndexError):
                        pass

                # 硬过滤：有定位时只保留 5km 以内
                if user_lng is not None and (dist_m is None or dist_m > MAX_DISTANCE_M):
                    continue

                # 解析评分数值（用于后续加权排序）
                raw_rating = poi.get("biz_ext", {}).get("rating", "")
                rating_num = None
                if raw_rating and raw_rating != "暂无评分":
                    try:
                        rating_num = float(raw_rating)
                    except (ValueError, TypeError):
                        pass

                raw_candidates.append({
                    "name": poi.get("name", "未知"),
                    "address": poi.get("address", "未知"),
                    "location": poi_loc,
                    "type": poi.get("type", ""),
                    "rating": raw_rating or "暂无评分",
                    "cost": poi.get("biz_ext", {}).get("cost", "暂无价格"),
                    "distance_m": dist_m,
                    "rating_num": rating_num,
                })

            # 综合评分排序：距离权重 0.6 + 评分权重 0.4
            # 距离得分：1km 内=1.0，5km=0.0，线性衰减
            # 评分得分：5 分=1.0，0 分=0.0，无评分=0.5（中等偏下）
            def _candidate_score(c):
                dist_score = 0.0
                if c["distance_m"] is not None:
                    dist_score = max(0.0, 1.0 - c["distance_m"] / MAX_DISTANCE_M)
                rating_score = 0.5  # 无评分的默认分
                if c["rating_num"] is not None:
                    rating_score = min(c["rating_num"], 5.0) / 5.0
                return dist_score * 0.6 + rating_score * 0.4

            raw_candidates.sort(key=_candidate_score, reverse=True)

            # 取排序后的候选，用 type + name 做硬过滤，只保留匹配的
            for c in raw_candidates:
                if _type_matches_search(user_message, c["name"], c["type"]):
                    dist_str = ""
                    if c["distance_m"] is not None:
                        d = c["distance_m"]
                        dist_str = f"{d}m" if d < 1000 else f"{d / 1000:.1f}km"
                    candidates.append({
                        "name": c["name"],
                        "address": c["address"],
                        "location": c["location"],
                        "type": c["type"],
                        "rating": c["rating"],
                        "cost": c["cost"],
                        "distance_text": dist_str,
                    })
                    if len(candidates) >= 5:
                        break
            # 如果过滤后候选不足 2 家，放宽过滤条件补充一些（避免空列表）
            if len(candidates) < 2:
                for c in raw_candidates:
                    already_added = any(x["name"] == c["name"] for x in candidates)
                    if not already_added:
                        dist_str = ""
                        if c["distance_m"] is not None:
                            d = c["distance_m"]
                            dist_str = f"{d}m" if d < 1000 else f"{d / 1000:.1f}km"
                        candidates.append({
                            "name": c["name"],
                            "address": c["address"],
                            "location": c["location"],
                            "type": c["type"],
                            "rating": c["rating"],
                            "cost": c["cost"],
                            "distance_text": dist_str,
                        })
                        if len(candidates) >= 5:
                            break
        if candidates:
            candidates_text = "以下是高德地图搜索到的南京真实餐厅信息（供参考）：\n"
            for index, candidate in enumerate(candidates, 1):
                dist_text = f"距离约{candidate['distance_text']}，" if candidate['distance_text'] else ""
                candidates_text += (
                    f"{index}. {candidate['name']} - {candidate['address']} - "
                    f"{dist_text}"
                    f"评分{candidate['rating']} - 人均{candidate['cost']} - "
                    f"高德分类：{candidate['type']}\n"
                )
        else:
            candidates_text = "（高德地图未搜到相关餐厅，请根据自己的知识推荐）"

    system_prompt = (
        "你是「南大图谱」校园群里的一个机器人，同学们叫你小南。\n"
        "你和大家很熟，说话像朋友一样——亲切、口语化，偶尔带点俏皮但不油腻。\n"
        "\n"
        "核心设定：\n"
        "1. 你只推荐南京市范围内的餐厅和场所。问到其他城市就老实说「我只熟南京这一片，别的地方你问问别人～」\n"
        "2. 你不是万能助手。别人聊编程、数学、政治、养生，你就说「这个我不太懂诶，不如聊聊南京哪家鸭血粉丝汤好喝？」\n"
        "3. 推荐餐厅时只能使用高德地图搜到的真实数据。你拥有的信息仅包括：店名、地址、评分、人均价格、高德分类。你无法获取顾客评论、菜品图片、菜单、排队情况等。如果用户问你要评论、要具体菜品、要菜单——直接说「这个我查不到，我只有评分和人均，你可以去大众点评看看真实评价」，不要自己编造。\n"
        "4. 如果用户缺少关键信息（想去哪个区？人均预算？几个人？），友好追问一两句，不要一口气问太多。\n"
        "5. 推荐1-2家即可，简单说理由。输出纯文本，不加 Markdown。\n"
        "6. 不要用「种草」「安利」「必吃」「绝绝子」这种营销口吻。推荐理由用「同学们常去」「评分不错」「性价比高」这种日常表达。\n"
        "7. 打招呼、闲聊、问天气、说「谢谢」之类，就正常聊天，不要硬扯到推荐上。\n"
        f"{preference_text}\n"
        "8. 对于候选结果中的场所，你要根据它们的「名称」和「高德分类」来判断是否真的符合用户的需求。"
        "如果用户要找某一类场所（例如咖啡厅、奶茶店、川菜馆），但某个候选场所的名称和分类明显不符合（例如叫「某某食品店」、"
        "「某某茶行」、分类是「银行」「便利店」等），你就应该把它从推荐列表中排除，"
        "并在回复中如实说明「这家xx本质上不是xx店，不推荐给你」或类似表达。宁可推荐少一些，也不要推荐不合适的店铺。\n"
        "9. 如果用户问「好吃的xx」（例如「好吃的咖啡厅」），你应该意识到「吃」这个动词用错了——咖啡厅是喝的不是吃的。"
        "用幽默的方式指出：「是不是想说好喝的咖啡厅呀？」然后再做推荐。同理，用户说「好喝的川菜馆」也要纠正为「好吃的」。\n"
        "\n"
        "如果用户第一次来聊天，可以主动打招呼：「嘿，我是小南！在南大附近找吃的随时问我～」"
    )

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(history)
    user_content = user_message
    if candidates_text:
        user_content = f"{user_message}\n\n{candidates_text}"
    messages.append({"role": "user", "content": user_content})

    try:
        reply = chat_with_llm(messages, temperature=0.7, max_tokens=500)
        _save_conversation_message(user_id, session_id, "user", user_message)
        _save_conversation_message(user_id, session_id, "assistant", reply)
        db.session.commit()
        log_event(
            current_app.logger,
            "conversation_turn_saved",
            user_id=user_id,
            session_id=session_id,
            history_count=len(history),
        )
        return jsonify({"session_id": session_id, "reply": reply, "candidates": candidates})
    except Exception as exc:
        db.session.rollback()
        log_event(current_app.logger, "chat_recommend_failed", level="error", user_id=user_id, error=str(exc))
        return error_response("AI 回复失败", 502, code="llm_error")


@llm_bp.route("/conversation/<session_id>/messages", methods=["GET"])
@jwt_required
@limiter.limit("60 per minute")
def get_conversation_messages(session_id):
    """获取指定会话的所有历史消息。
    
    只有当前登录用户有权访问自己的会话消息。
    """
    from app.models import ConversationMessage
    
    user_id = g.current_user_id
    
    # 验证会话属于当前用户
    messages = (
        ConversationMessage.query
        .filter_by(user_id=user_id, session_id=session_id)
        .order_by(ConversationMessage.created_at.asc())
        .all()
    )
    
    return jsonify({
        "session_id": session_id,
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in messages
        ]
    })


@llm_bp.route("/conversation/<session_id>", methods=["DELETE"])
@jwt_required
@limiter.limit("30 per minute")
def delete_conversation(session_id):
    """删除整个会话及其所有消息。"""
    from app.models import ConversationMessage
    
    user_id = g.current_user_id
    deleted_count = ConversationMessage.query.filter_by(
        user_id=user_id, session_id=session_id
    ).delete()
    db.session.commit()
    
    log_event(
        current_app.logger,
        "conversation_deleted",
        user_id=user_id,
        session_id=session_id,
        message_count=deleted_count,
    )
    return jsonify({"message": "会话已删除", "deleted_count": deleted_count})
