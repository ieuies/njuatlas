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
                "你是一个资深美食评论家，说话风格俏皮、接地气、吸引年轻人。"
                "请根据餐厅信息和已有评价，生成一句不超过 40 字的推荐语。"
                "不要使用'这家店'、'它'等代词，要直接、有感染力。"
            ),
        },
        {
            "role": "user",
            "content": f"餐厅名称：{restaurant.name}\n地址：{restaurant.address or '未知'}\n{reviews_text}\n\n请为这家餐厅写一句推荐语。",
        },
    ]

    try:
        slogan = chat_with_llm(messages, temperature=0.9, max_tokens=100)
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

    search_result = search_places(user_message, city=city, page=1, page_size=10)
    candidates = []
    if search_result.get("status") == "1":
        for poi in search_result.get("pois", [])[:5]:
            candidates.append({
                "name": poi.get("name", "未知"),
                "address": poi.get("address", "未知"),
                "location": poi.get("location", ""),
                "rating": poi.get("biz_ext", {}).get("rating", "暂无评分"),
                "cost": poi.get("biz_ext", {}).get("cost", "暂无价格"),
            })

    if not candidates:
        candidates_text = "（未找到匹配的餐厅，请推荐几家南京的知名餐厅）"
    else:
        candidates_text = "以下是搜索到的真实餐厅：\n"
        for index, candidate in enumerate(candidates, 1):
            candidates_text += (
                f"{index}. {candidate['name']} - {candidate['address']} - "
                f"评分{candidate['rating']} - 人均{candidate['cost']}\n"
            )

    system_prompt = (
        "你是一个友好的美食推荐助手，专门帮南京的大学生推荐附近好吃的餐厅。\n"
        "规则：\n"
        "1. 推荐时必须基于真实存在的餐厅信息，不要编造。\n"
        "2. 回答要生动、热情，有'种草'的感觉。\n"
        "3. 每次推荐 2~3 家，说明推荐理由。\n"
        "4. 要考虑到用户的口味偏好。\n"
        f"{preference_text}"
    )

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(history)
    messages.append({"role": "user", "content": f"{user_message}\n\n{candidates_text}"})

    try:
        reply = chat_with_llm(messages, temperature=0.8, max_tokens=600)
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
