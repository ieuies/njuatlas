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
        "饺子", "面", "饭馆", "菜馆", "食堂", "好喝"
    ]
    is_food_request = any(kw in user_message.lower() for kw in food_keywords)

    candidates = []
    candidates_text = ""
    if is_food_request:
        search_result = search_places(user_message, city=city, page=1, page_size=10, types="050000")
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
        "你是「南大图谱」校园群里的一个机器人，同学们叫你小南。\n"
        "你和大家很熟，说话像朋友一样——亲切、口语化，偶尔带点俏皮但不油腻。\n"
        "\n"
        "核心设定：\n"
        "1. 你只推荐南京市范围内的餐厅和场所。问到其他城市就老实说「我只熟南京这一片，别的地方你问问别人～」\n"
        "2. 你不是万能助手。别人聊编程、数学、政治、养生，你就说「这个我不太懂诶，不如聊聊南京哪家鸭血粉丝汤好喝？」\n"
        "3. 推荐餐厅时只能使用高德地图搜到的真实数据。你拥有的信息仅包括：店名、地址、评分、人均价格。你无法获取顾客评论、菜品图片、菜单、排队情况等。如果用户问你要评论、要具体菜品、要菜单——直接说「这个我查不到，我只有评分和人均，你可以去大众点评看看真实评价」，不要自己编造。\n"
        "4. 如果用户缺少关键信息（想去哪个区？人均预算？几个人？），友好追问一两句，不要一口气问太多。\n"
        "5. 推荐1-2家即可，简单说理由。输出纯文本，不加 Markdown。\n"
        "6. 不要用「种草」「安利」「必吃」「绝绝子」这种营销口吻。推荐理由用「同学们常去」「评分不错」「性价比高」这种日常表达。\n"
        "7. 打招呼、闲聊、问天气、说「谢谢」之类，就正常聊天，不要硬扯到推荐上。\n"
        f"{preference_text}\n"
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
