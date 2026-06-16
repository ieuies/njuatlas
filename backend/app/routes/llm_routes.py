import json

from flask import Blueprint, Response, current_app, g, jsonify, request, stream_with_context
from sqlalchemy.exc import SQLAlchemyError

from app import db
from app.auth_utils import jwt_required
from app.errors import error_response
from app.logging_utils import log_event
from app.models import ConversationMessage, Favorite, Like, Place, Review
from app.rate_limit import limiter
from app.services.ai_recommend import prepare_chat_recommend_context, sanitize_llm_reply
from app.services.llm import chat_with_llm, stream_chat_with_llm
from app.validators import clean_string, get_json_body, positive_int, validate_session_id


llm_bp = Blueprint("llm", __name__, url_prefix="/api/llm")

_XIAONAN_SYSTEM = (
    "你是「南大图谱」校园群里的机器人，同学们叫你小南。\n"
    "说话像朋友一样——亲切、口语化，偶尔俏皮不油腻。\n\n"
    "1. 只推荐南京市内餐饮/饮品，只熟南京这一片。\n"
    "2. 推荐时只能使用系统提供的候选列表；候选来自吃喝玩乐页面，"
    "仅含高德固定餐饮分类 POI（美食/咖啡饮品），信息只有店名、地址、评分、人均。\n"
    "3. 禁止编造评论、菜单、排队；没有评分/人均就省略，不提「暂无评分」。\n"
    "4. 禁止说「帮你查到了和某某相关的店」「我用某某关键词检索了」等套话；"
    "禁止把用户原句拆成词复述（如「我想 一个人 饭」）。\n"
    "5. 安静/环境/便宜/评分高等主观条件：按候选里的距离、人均、评分推荐，"
    "并说明数据里没有氛围标签时无法保证安静。\n"
    "6. 用户问「附近有什么吃的」等宽泛问题时：先追问想吃什么类型，本轮禁止推荐店铺。\n"
    "7. 用户提到「附近/周边」时，推荐时优先选距离更近的候选。\n"
    "8. 推荐1-2家为主；闲聊正常回应，非美食话题轻松带过。\n"
    "输出纯文本，不用 Markdown。\n"
)


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


def _sse_event(event, payload):
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _emit_chat_recommend_response(
    *,
    stream_mode,
    session_id,
    reply=None,
    candidates=None,
    llm_messages=None,
    user_id=None,
    user_message=None,
    sanitize_candidates=None,
    sanitize_needs_clarification=False,
):
    public_candidates = candidates or []

    if not stream_mode:
        return jsonify({
            "session_id": session_id,
            "reply": reply,
            "candidates": public_candidates,
        })

    @stream_with_context
    def generate():
        yield _sse_event("meta", {
            "session_id": session_id,
            "candidates": public_candidates,
        })

        if llm_messages is not None:
            parts = []
            try:
                _save_conversation_message(user_id, session_id, "user", user_message)
                db.session.commit()
                for chunk in stream_chat_with_llm(llm_messages, temperature=0.75, max_tokens=650):
                    parts.append(chunk)
                full_reply = sanitize_llm_reply(
                    "".join(parts),
                    candidates_api=sanitize_candidates,
                    needs_clarification=sanitize_needs_clarification,
                )
                step = 18
                for i in range(0, len(full_reply), step):
                    yield _sse_event("token", {"text": full_reply[i:i + step]})
                _save_conversation_message(user_id, session_id, "assistant", full_reply)
                db.session.commit()
                log_event(
                    current_app.logger,
                    "conversation_turn_saved",
                    user_id=user_id,
                    session_id=session_id,
                    streamed=True,
                )
                yield _sse_event("done", {"reply": full_reply})
            except Exception as exc:
                db.session.rollback()
                log_event(
                    current_app.logger,
                    "chat_recommend_stream_failed",
                    level="error",
                    user_id=user_id,
                    error=str(exc),
                )
                if isinstance(exc, SQLAlchemyError):
                    message = "数据库操作失败。"
                else:
                    message = "AI 回复失败"
                yield _sse_event("error", {"message": message})
            return

        text = reply or ""
        step = 18
        for i in range(0, len(text), step):
            yield _sse_event("token", {"text": text[i:i + step]})
        yield _sse_event("done", {"reply": text})

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _build_system_prompt(preference_text=""):
    extra = f"{preference_text}\n" if preference_text else ""
    return _XIAONAN_SYSTEM + extra


@llm_bp.route("/chat_recommend", methods=["POST"])
@jwt_required
@limiter.limit("10 per minute")
def chat_recommend():
    data = get_json_body(request)
    user_message = clean_string(data.get("message"), "message", required=True, max_length=500)
    session_id = validate_session_id(data.get("session_id")) or ConversationMessage.new_session_id()
    stream_mode = bool(data.get("stream"))
    user_id = g.current_user_id
    history = _load_conversation_history(user_id, session_id)

    liked = Like.query.filter_by(user_id=user_id).limit(10).all()
    favorited = Favorite.query.filter_by(user_id=user_id).limit(10).all()
    place_names = {item.place.name for item in liked} | {item.place.name for item in favorited}
    preference_text = ""
    if place_names:
        preference_text = "这位用户喜欢的场所有：" + "、".join(list(place_names)[:5]) + "。"

    user_location = clean_string(data.get("location"), "location", max_length=50)
    ctx = prepare_chat_recommend_context(
        user_message, user_id=user_id, gps_location=user_location, history=history,
    )

    candidates_api = []
    candidates_text = ""
    if ctx.get("needs_clarification"):
        candidates_text = ctx["clarification_text"]
    elif ctx["is_food_request"]:
        candidates_api = ctx["candidates_api"]
        candidates_text = ctx["candidates_text"]

    messages = [{"role": "system", "content": _build_system_prompt(preference_text)}]
    messages.extend(history)
    user_content = user_message
    if candidates_text:
        user_content = f"{user_message}\n\n{candidates_text}"
    messages.append({"role": "user", "content": user_content})

    try:
        if stream_mode:
            return _emit_chat_recommend_response(
                stream_mode=True,
                session_id=session_id,
                candidates=candidates_api,
                llm_messages=messages,
                user_id=user_id,
                user_message=user_message,
                sanitize_candidates=candidates_api,
                sanitize_needs_clarification=ctx.get("needs_clarification"),
            )
        reply = chat_with_llm(messages, temperature=0.75, max_tokens=650)
        reply = sanitize_llm_reply(
            reply,
            candidates_api=candidates_api,
            needs_clarification=ctx.get("needs_clarification"),
        )
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
        return jsonify({
            "session_id": session_id,
            "reply": reply,
            "candidates": candidates_api,
        })
    except Exception as exc:
        db.session.rollback()
        log_event(current_app.logger, "chat_recommend_failed", level="error", user_id=user_id, error=str(exc))
        return error_response("AI 回复失败", 502, code="llm_error")


@llm_bp.route("/conversation/<session_id>/messages", methods=["GET"])
@jwt_required
@limiter.limit("60 per minute")
def get_conversation_messages(session_id):
    user_id = g.current_user_id
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
        ],
    })


@llm_bp.route("/conversation/<session_id>", methods=["DELETE"])
@jwt_required
@limiter.limit("30 per minute")
def delete_conversation(session_id):
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


@llm_bp.route("/conversations/batch_delete", methods=["POST"])
@jwt_required
@limiter.limit("10 per minute")
def batch_delete_conversations():
    user_id = g.current_user_id
    data = get_json_body(request)
    session_ids = data.get("session_ids")

    if not isinstance(session_ids, list) or not session_ids:
        return error_response("session_ids 必须是非空数组", 400, code="invalid_session_ids")

    validated_ids = []
    seen = set()
    for raw_session_id in session_ids[:200]:
        sid = validate_session_id(raw_session_id)
        if not sid or sid in seen:
            continue
        seen.add(sid)
        validated_ids.append(sid)

    if not validated_ids:
        return error_response("没有可删除的有效会话", 400, code="invalid_session_ids")

    existing_rows = (
        db.session.query(ConversationMessage.session_id)
        .filter(
            ConversationMessage.user_id == user_id,
            ConversationMessage.session_id.in_(validated_ids),
        )
        .distinct()
        .all()
    )
    existing_session_ids = [row[0] for row in existing_rows]

    if not existing_session_ids:
        return jsonify({
            "message": "没有匹配到可删除会话",
            "deleted_sessions": 0,
            "deleted_messages": 0,
        })

    deleted_messages = (
        ConversationMessage.query
        .filter(
            ConversationMessage.user_id == user_id,
            ConversationMessage.session_id.in_(existing_session_ids),
        )
        .delete(synchronize_session=False)
    )
    db.session.commit()

    log_event(
        current_app.logger,
        "conversations_batch_deleted",
        user_id=user_id,
        deleted_sessions=len(existing_session_ids),
        deleted_messages=deleted_messages,
    )
    return jsonify({
        "message": "批量删除成功",
        "deleted_sessions": len(existing_session_ids),
        "deleted_messages": deleted_messages,
    })
