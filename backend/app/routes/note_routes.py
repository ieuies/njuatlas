"""
帖子系统路由 —— 搭子论坛 / 活动事件 的 CRUD 与互动。

所有帖子的业务逻辑委托给 NoteSystem 和 SingleNote，
路由层只做：收参数 → 调服务 → 返回 JSON。
"""

from flask import Blueprint, g, jsonify, request

from app.auth_utils import jwt_required
from app.errors import error_response
from app.rate_limit import limiter
from app.services.note import NoteSystem, SingleNote
from app.validators import clean_string, get_json_body, int_range, optional_rating


note_bp = Blueprint("note", __name__, url_prefix="/api")


# ── 辅助：获取当前用户的 NoteSystem 实例 ──────────────────────
def _ns():
    return NoteSystem(user_id=g.current_user_id)


# ═══════════════════════════════════════════════════════════════
# 帖子 CRUD
# ═══════════════════════════════════════════════════════════════

@note_bp.route("/posts", methods=["POST"])
@jwt_required
@limiter.limit("30 per minute")
def create_post():
    """创建帖子。

    请求 JSON:
        {
          "type": "forum",           // 'event' 或 'forum'，默认 'forum'
          "title": "找羽毛球搭子",
          "content": "仙林校区，每周三下午...",
          "tags": ["羽毛球", "仙林"],
          "place_id": 1,             // 可选，关联场所
          "event_time": "2026-06-15T15:00:00Z",  // event 类型建议传
          "location": "118.93,32.10",
          "location_name": "仙林校区体育馆"
        }
    """
    data = get_json_body(request)
    title = clean_string(data.get("title"), "title", required=True, max_length=100)
    content = clean_string(data.get("content"), "content", required=True, max_length=2000)
    post_type = clean_string(data.get("type", "forum"), "type", max_length=20) or "forum"
    urgency = clean_string(data.get("urgency"), "urgency", max_length=20)
    if urgency and urgency not in ("now", "long_term", "scheduled"):
        return error_response("urgency 必须是 now / long_term / scheduled", 400)
    tags = data.get("tags", [])
    if not isinstance(tags, list):
        tags = []
    tags = [t.strip() for t in tags if isinstance(t, str) and t.strip()][:10]

    place_id = data.get("place_id")
    if place_id is not None:
        place_id = int_range(place_id, "place_id", min_value=1)

    event_time = data.get("event_time")
    from datetime import datetime
    if event_time:
        try:
            event_time = datetime.fromisoformat(event_time.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return error_response("event_time 格式无效，请使用 ISO 8601 格式", 400)

    # scheduled 模式必须有 event_time
    if urgency == "scheduled" and not event_time:
        return error_response("指定时间模式下必须提供 event_time", 400)

    location = clean_string(data.get("location"), "location", max_length=50)
    location_name = clean_string(data.get("location_name"), "location_name", max_length=200)

    note = _ns().create_post(
        type=post_type,
        title=title,
        content=content,
        tags=tags,
        place_id=place_id,
        event_time=event_time,
        urgency=urgency,
        location=location,
        location_name=location_name,
    )
    return jsonify(note.to_dict(current_user_id=g.current_user_id)), 201


@note_bp.route("/posts", methods=["GET"])
def list_posts():
    """帖子列表 —— 多维筛选。

    查询参数:
        ?type=event|forum      帖子类型
        ?tags=羽毛球,仙林      标签筛选（逗号分隔，AND 逻辑）
        ?place_id=1            关联指定场所
        ?user_id=1             只看某用户发的帖
        ?sort=hot|new|nearby   排序（默认 hot）
        ?lat=32.10&lng=118.93 附近排序所需坐标
        ?page=1&page_size=20   分页
    """
    post_type = clean_string(request.args.get("type"), "type", max_length=20)
    tags_raw = request.args.get("tags", "")
    tags = [t.strip() for t in tags_raw.split(",") if t.strip()] if tags_raw else None

    place_id = request.args.get("place_id", type=int)
    user_id = request.args.get("user_id", type=int)
    sort = clean_string(request.args.get("sort", "hot"), "sort", max_length=20) or "hot"

    lat = request.args.get("lat", type=float)
    lng = request.args.get("lng", type=float)
    radius = int_range(request.args.get("radius", 5000), "radius", min_value=100, max_value=50000)

    page = int_range(request.args.get("page", 1), "page", min_value=1)
    page_size = int_range(request.args.get("page_size", 20), "page_size", min_value=1, max_value=50)

    notes = NoteSystem(user_id=g.current_user_id if hasattr(g, "current_user_id") else None)
    result = notes.search(
        type=post_type,
        tags=tags,
        place_id=place_id,
        sort=sort,
        lat=lat,
        lng=lng,
        radius=radius,
        user_id=user_id,
        page=page,
        page_size=page_size,
    )
    return jsonify(result)


@note_bp.route("/posts/<int:post_id>", methods=["GET"])
def get_post(post_id):
    """帖子详情。

    浏览计数 +1（未登录用户也计入）。
    返回帖子内容、评论列表、参与用户列表。
    """
    notes = NoteSystem(user_id=g.current_user_id if hasattr(g, "current_user_id") else None)
    note = notes.get_post(post_id)
    if not note:
        return error_response("帖子不存在", 404, code="post_not_found")

    note.record_view()
    data = note.to_dict(current_user_id=notes.user_id, include_place=True)
    data["comments"] = note.get_comments()
    data["participants"] = note.get_participants()
    return jsonify(data)


@note_bp.route("/posts/<int:post_id>", methods=["PUT"])
@jwt_required
@limiter.limit("30 per minute")
def update_post(post_id):
    """编辑帖子（仅帖主）。"""
    notes = _ns()
    note = notes.get_post(post_id)
    if not note:
        return error_response("帖子不存在", 404, code="post_not_found")
    if not note.can_edit(g.current_user_id):
        return error_response("无权编辑", 403, code="forbidden")

    data = get_json_body(request)
    title = clean_string(data.get("title"), "title", max_length=100)
    content = clean_string(data.get("content"), "content", max_length=2000)
    urgency = clean_string(data.get("urgency"), "urgency", max_length=20)
    if urgency and urgency not in ("now", "long_term", "scheduled"):
        return error_response("urgency 必须是 now / long_term / scheduled", 400)
    tags = data.get("tags")
    if tags is not None and isinstance(tags, list):
        tags = [t.strip() for t in tags if isinstance(t, str) and t.strip()][:10]

    event_time = data.get("event_time")
    from datetime import datetime
    if event_time:
        try:
            event_time = datetime.fromisoformat(event_time.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return error_response("event_time 格式无效", 400)

    # scheduled 模式必须有 event_time（编辑时也校验）
    if urgency == "scheduled" and not event_time and not note.event_time:
        return error_response("指定时间模式下必须提供 event_time", 400)

    updated = notes.update_post(
        post_id,
        title=title,
        content=content,
        tags=tags,
        event_time=event_time,
        urgency=urgency,
        location=clean_string(data.get("location"), "location", max_length=50),
        location_name=clean_string(data.get("location_name"), "location_name", max_length=200),
    )
    return jsonify(updated.to_dict(current_user_id=g.current_user_id))


@note_bp.route("/posts/<int:post_id>", methods=["DELETE"])
@jwt_required
@limiter.limit("30 per minute")
def delete_post(post_id):
    """删除帖子（仅帖主）。"""
    notes = _ns()
    note = notes.get_post(post_id)
    if not note:
        return error_response("帖子不存在", 404, code="post_not_found")
    if not note.can_edit(g.current_user_id):
        return error_response("无权删除", 403, code="forbidden")

    note.delete()
    return jsonify({"message": "已删除"})


# ═══════════════════════════════════════════════════════════════
# 帖子互动
# ═══════════════════════════════════════════════════════════════

@note_bp.route("/posts/<int:post_id>/like", methods=["POST"])
@jwt_required
@limiter.limit("60 per minute")
def toggle_like(post_id):
    """切换帖子点赞状态。"""
    notes = _ns()
    note = notes.get_post(post_id)
    if not note:
        return error_response("帖子不存在", 404, code="post_not_found")

    liked = note.toggle_like(g.current_user_id)
    return jsonify({"liked": liked, "like_count": note.like_count})


@note_bp.route("/posts/<int:post_id>/comments", methods=["POST"])
@jwt_required
@limiter.limit("30 per minute")
def add_comment(post_id):
    """发表评论。

    请求 JSON:
        { "content": "我也想去！", "parent_id": 5 }  // parent_id 可选，用于回复
    """
    notes = _ns()
    note = notes.get_post(post_id)
    if not note:
        return error_response("帖子不存在", 404, code="post_not_found")

    data = get_json_body(request)
    content = clean_string(data.get("content"), "content", required=True, max_length=500)
    parent_id = int_range(data.get("parent_id"), "parent_id", min_value=1) if data.get("parent_id") else None

    comment = note.add_comment(g.current_user_id, content, parent_id=parent_id)
    return jsonify({
        "id": comment.id,
        "content": comment.content,
        "user_id": comment.user_id,
        "username": g.current_user.username,
        "created_at": comment.created_at.isoformat() if comment.created_at else None,
    }), 201


@note_bp.route("/posts/<int:post_id>/comments", methods=["GET"])
def get_comments(post_id):
    """获取帖子评论列表。"""
    notes = NoteSystem(user_id=g.current_user_id if hasattr(g, "current_user_id") else None)
    note = notes.get_post(post_id)
    if not note:
        return error_response("帖子不存在", 404, code="post_not_found")

    page = int_range(request.args.get("page", 1), "page", min_value=1)
    page_size = int_range(request.args.get("page_size", 20), "page_size", min_value=1, max_value=50)
    return jsonify(note.get_comments(page=page, page_size=page_size))


@note_bp.route("/posts/<int:post_id>/participate", methods=["POST"])
@jwt_required
@limiter.limit("30 per minute")
def participate(post_id):
    """报名/取消报名活动。

    请求 JSON:
        { "status": "going" }   // 'going'（确定去）或 'interested'（感兴趣）
    再次传相同 status 则取消。
    """
    notes = _ns()
    note = notes.get_post(post_id)
    if not note:
        return error_response("帖子不存在", 404, code="post_not_found")
    if note.type != "event":
        return error_response("只有活动帖支持报名", 400, code="not_event_post")

    data = get_json_body(request)
    status = clean_string(data.get("status", "going"), "status", max_length=20) or "going"
    if status not in ("going", "interested"):
        return error_response("status 必须是 going 或 interested", 400)

    result = note.participate(g.current_user_id, status=status)
    return jsonify({
        "status": result,
        "participant_count": note.participant_count,
    })


# ═══════════════════════════════════════════════════════════════
# 标签
# ═══════════════════════════════════════════════════════════════

@note_bp.route("/tags", methods=["GET"])
def list_tags():
    """获取标签列表。?category=food|activity|identity"""
    category = clean_string(request.args.get("category"), "category", max_length=20)
    return jsonify({"items": NoteSystem.list_tags(category=category)})


@note_bp.route("/me/tags", methods=["GET"])
@jwt_required
def get_my_tags():
    """获取当前用户的兴趣标签。"""
    return jsonify({"items": _ns().get_user_tags()})


@note_bp.route("/me/tags", methods=["PUT"])
@jwt_required
@limiter.limit("30 per minute")
def set_my_tags():
    """设置当前用户的兴趣标签。

    请求 JSON:
        { "tags": ["羽毛球", "川菜", "研一"] }
    """
    data = get_json_body(request)
    tags = data.get("tags", [])
    if not isinstance(tags, list):
        return error_response("tags 必须是数组", 400)
    tags = [t.strip() for t in tags if isinstance(t, str) and t.strip()][:20]
    _ns().set_user_tags(tags)
    return jsonify({"items": _ns().get_user_tags()})


# ═══════════════════════════════════════════════════════════════
# 场所关联帖子
# ═══════════════════════════════════════════════════════════════

@note_bp.route("/places/<int:place_id>/posts", methods=["GET"])
def place_posts(place_id):
    """获取某个场所下的所有 UGC 帖子。"""
    from app.models import Place
    place = Place.query.get(place_id)
    if not place:
        return error_response("场所不存在", 404, code="place_not_found")

    page = int_range(request.args.get("page", 1), "page", min_value=1)
    page_size = int_range(request.args.get("page_size", 10), "page_size", min_value=1, max_value=50)

    notes = NoteSystem(user_id=g.current_user_id if hasattr(g, "current_user_id") else None)
    result = notes.posts_for_place(place_id, page=page, page_size=page_size)
    # 附带场所基本信息
    result["place"] = {
        "id": place.id,
        "name": place.name,
        "address": place.address,
        "location": place.location,
        "category": place.category,
    }
    return jsonify(result)


# ═══════════════════════════════════════════════════════════════
# 地点搜索（高德 POI 输入提示代理）
# ═══════════════════════════════════════════════════════════════

@note_bp.route("/places/suggestions", methods=["GET"])
def place_suggestions():
    """高德 POI 输入提示代理 —— 供前端地点搜索自动补全。

    查询参数:
        ?keyword=大米      搜索关键词
        ?city=南京         限定城市（可选）
    """
    from app.services.amap import inputtips

    keyword = clean_string(request.args.get("keyword"), "keyword", required=True, max_length=50)
    city = clean_string(request.args.get("city", "南京"), "city", max_length=30)

    try:
        data = inputtips(keyword, city=city)
    except Exception:
        return error_response("地点搜索服务暂时不可用", 502)

    tips = []
    for t in data.get("tips", []):
        loc = t.get("location")
        if not loc:
            continue
        if isinstance(loc, dict):
            loc = f"{loc.get('lng', '')},{loc.get('lat', '')}"
        tips.append({
            "name": t.get("name", ""),
            "address": t.get("address", ""),
            "district": t.get("district", ""),
            "location": loc,
        })

    return jsonify({"tips": tips})
