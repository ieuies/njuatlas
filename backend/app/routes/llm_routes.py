from flask import Blueprint, current_app, g, jsonify, request

from app import db
from app.auth_utils import jwt_required
from app.errors import error_response
from app.logging_utils import log_event
from app.models import ConversationMessage, Favorite, Like, Restaurant, Review
from app.rate_limit import limiter
from app.services.amap import search_places
from app.services.llm import chat_with_llm
from app.validators import clean_string, get_json_body, positive_int, validate_session_id


llm_bp = Blueprint("llm", __name__, url_prefix="/api/llm")


@llm_bp.route("/recommend_slogan", methods=["GET"])
@limiter.limit("20 per minute")
def recommend_slogan():
    restaurant_id = positive_int(request.args.get("restaurant_id"), "restaurant_id")
    restaurant = Restaurant.query.get(restaurant_id)
    if not restaurant:
        return error_response("餐厅不存在", 404, code="restaurant_not_found")

    reviews = Review.query.filter_by(restaurant_id=restaurant_id).limit(3).all()
    reviews_text = ""
    if reviews:
        reviews_text = "已有食客评价：" + "；".join([r.content for r in reviews])

    messages = [
        {
            "role": "system",
            "content": (
                "用一句不超过30字的口语评价描述这家餐厅。"
                "语气自然，像朋友随口说的一样。"
                "禁止使用 Markdown 语法，只输出纯文本。"
                "不要用'这家店'、'它'等代词。"
            ),
        },
        {
            "role": "user",
            "content": f"餐厅名称：{restaurant.name}\n地址：{restaurant.address or '未知'}\n{reviews_text}\n\n用一句话评价这家餐厅。",
        },
    ]

    try:
        slogan = chat_with_llm(messages, temperature=0.7, max_tokens=60)
        return jsonify({"restaurant_id": restaurant_id, "slogan": slogan})
    except Exception as exc:
        log_event(current_app.logger, "slogan_generation_failed", level="error", restaurant_id=restaurant_id, error=str(exc))
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

    restaurant_names = set()
    for item in liked:
        restaurant_names.add(item.restaurant.name)
    for item in favorited:
        restaurant_names.add(item.restaurant.name)

    preference_text = ""
    if restaurant_names:
        preference_text = "这位用户喜欢的餐厅有：" + "、".join(list(restaurant_names)[:5]) + "。"

    # 意图判断：只有用户明确在找餐厅时才去高德搜索
    food_keywords = [
        "吃", "饭", "餐厅", "美食", "推荐", "好吃", "饿了", "夜宵", "早餐",
        "午餐", "晚餐", "川菜", "湘菜", "火锅", "烧烤", "咖啡", "奶茶",
        "外卖", "堂食", "食堂", "哪家", "哪里", "什么店", "有啥", "有没有",
        "菜单", "点菜", "请客", "聚餐", "约会", "小吃", "甜点", "面包",
        "饺子", "面", "饭馆", "菜馆", "食堂", "好喝"
    ]
    is_food_request = any(kw in user_message.lower() for kw in food_keywords)

    candidates = []
    candidates_text = ""
    if is_food_request:
        search_result = search_places(user_message, city=city, page=1, page_size=10)
        if search_result.get("status") == "1":
            for poi in search_result.get("pois", [])[:5]:
                candidates.append({
                    "name": poi.get("name", "未知"),
                    "address": poi.get("address", "未知"),
                    "location": poi.get("location", ""),
                    "rating": poi.get("biz_ext", {}).get("rating", "暂无评分"),
                    "cost": poi.get("biz_ext", {}).get("cost", "暂无价格"),
                })
        if candidates:
            candidates_text = "以下是高德地图搜索到的南京真实餐厅信息（供参考）：\n"
            for index, candidate in enumerate(candidates, 1):
                candidates_text += (
                    f"{index}. {candidate['name']} - {candidate['address']} - "
                    f"评分{candidate['rating']} - 人均{candidate['cost']}\n"
                )
        else:
            candidates_text = "（高德地图未搜到相关餐厅，请根据自己的知识推荐）"

    system_prompt = (
        "你是一个群聊机器人，在\"南大图谱\"校园群里和同学们聊天。\n"
        "要求：\n"
        "1. 用口语化、自然的中文回复，像朋友聊天一样简短亲切。\n"
        "2. 不要使用营销/推荐语气，不要用\"种草\"\"安利\"\"必吃\"等词。\n"
        "3. 只输出纯文本，禁止使用任何 Markdown 语法（如 **加粗**、# 标题、- 列表、> 引用等）。\n"
        "4. 如果用户问餐厅推荐，基于真实信息回答，推荐1-2家即可，简单说理由。\n"
        "5. 如果用户只是打招呼、闲聊、说无关的话，就直接正常聊天，不要扯到餐厅推荐上。\n"
        "6. 注意：用户说的'你好''上下文''清空''谢谢'等不是找餐厅，不要强行推荐。\n"
        f"{preference_text}"
    )

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(history)
    user_content = user_message
    if candidates_text:
        user_content = f"{user_message}\n\n{candidates_text}"
    messages.append({"role": "user", "content": user_content})

    try:
        reply = chat_with_llm(messages, temperature=0.7, max_tokens=400)
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
