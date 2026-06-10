"""
帖子系统路由 —— 搭子论坛 / 活动事件 的 CRUD 与互动。

所有帖子的业务逻辑委托给 NoteSystem 和 SingleNote，
路由层只做：收参数 → 调服务 → 返回 JSON。
"""

from flask import Blueprint, g, jsonify, request

from app import db
from app.auth_utils import jwt_optional, jwt_required
from app.errors import error_response
from app.models import EventParticipant, PostFavorite, PostLike, PostTag
from app.rate_limit import limiter
from app.services.note import NoteSystem, SingleNote
from app.validators import clean_string, get_json_body, int_range


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
          "event_time": "2026-06-15T15:00:00Z",
          "event_end_time": "2026-06-15T17:00:00Z",  // 指定时间需传开始+结束
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
    event_end_time = data.get("event_end_time")
    from datetime import datetime
    if event_time:
        try:
            event_time = datetime.fromisoformat(event_time.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return error_response("event_time 格式无效，请使用 ISO 8601 格式", 400)
    if event_end_time:
        try:
            event_end_time = datetime.fromisoformat(event_end_time.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return error_response("event_end_time 格式无效，请使用 ISO 8601 格式", 400)

    # scheduled 模式必须有开始+结束时间，且结束晚于开始
    if urgency == "scheduled":
        if not event_time or not event_end_time:
            return error_response("指定时间模式下必须提供开始和结束时间", 400)
        if event_end_time <= event_time:
            return error_response("结束时间必须晚于开始时间", 400)
    else:
        event_time = None
        event_end_time = None

    location = clean_string(data.get("location"), "location", max_length=50)
    location_name = clean_string(data.get("location_name"), "location_name", max_length=200)
    max_participants = int_range(data.get("slots", 2), "slots", min_value=2, max_value=100)
    budget = clean_string(data.get("budget"), "budget", max_length=50)
    contact = clean_string(data.get("contact"), "contact", max_length=100)

    note = _ns().create_post(
        post_type=post_type,
        title=title,
        content=content,
        tags=tags,
        place_id=place_id,
        event_time=event_time,
        event_end_time=event_end_time,
        urgency=urgency,
        location=location,
        location_name=location_name,
        max_participants=max_participants,
        budget=budget,
        contact=contact,
    )
    return jsonify(note.to_dict(current_user_id=g.current_user_id)), 201


@note_bp.route("/posts", methods=["GET"])
@jwt_optional
def list_posts():
    """帖子列表 —— 多维筛选。

    查询参数:
        ?type=event|forum      帖子类型
        ?tags=羽毛球,仙林      标签筛选（逗号分隔，AND 逻辑）
        ?q=剧本杀              关键词搜索（标题/正文/地点/标签/发布者）
        ?place_id=1            关联指定场所
        ?user_id=1             只看某用户发的帖
        ?sort=hot|new|nearby   排序（默认 hot）
        ?lat=32.10&lng=118.93 附近排序所需坐标
        ?page=1&page_size=20   分页
    """
    post_type = clean_string(request.args.get("type"), "type", max_length=20)
    tags_raw = request.args.get("tags", "")
    tags = [t.strip() for t in tags_raw.split(",") if t.strip()] if tags_raw else None

    keyword_raw = request.args.get("q") or request.args.get("keyword")
    keyword = clean_string(keyword_raw, "q", required=False, min_length=1, max_length=50) if keyword_raw else None
    if keyword == "":
        keyword = None

    place_id = request.args.get("place_id", type=int)
    user_id = request.args.get("user_id", type=int)
    sort = clean_string(request.args.get("sort", "hot"), "sort", max_length=20) or "hot"
    if sort not in ("hot", "new", "nearby", "random"):
        sort = "hot"

    lat = request.args.get("lat", type=float)
    lng = request.args.get("lng", type=float)
    radius = int_range(request.args.get("radius", 5000), "radius", min_value=100, max_value=50000)

    page = int_range(request.args.get("page", 1), "page", min_value=1)
    page_size = int_range(request.args.get("page_size", 20), "page_size", min_value=1, max_value=100)

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
        keyword=keyword,
    )
    return jsonify(result)


@note_bp.route("/posts/<int:post_id>", methods=["GET"])
@jwt_optional
def get_post(post_id):
    """帖子详情。

    浏览计数 +1（未登录用户也计入）。
    返回帖子内容、评论列表、参与用户列表。
    优化：预加载标签/点赞/收藏/报名状态，避免 to_dict() 内部的额外查询。
    """
    notes = NoteSystem(user_id=g.current_user_id if hasattr(g, "current_user_id") else None)
    note = notes.get_post(post_id)
    if not note:
        return error_response("帖子不存在", 404, code="post_not_found")

    note.record_view()

    # ── 预加载：一次性查出 to_dict() 需要的用户状态，避免 N+1 ──
    user_id = notes.user_id
    if user_id:
        _is_liked = PostLike.query.filter_by(
            post_id=post_id, user_id=user_id
        ).first() is not None
        _is_favorited = PostFavorite.query.filter_by(
            post_id=post_id, user_id=user_id
        ).first() is not None
        part = EventParticipant.query.filter_by(
            post_id=post_id, user_id=user_id
        ).first()
        _participation = part.status if part else None
    else:
        _is_liked = False
        _is_favorited = False
        _participation = None
    _tags = [pt.tag.name for pt in PostTag.query.filter_by(post_id=post_id).all() if pt.tag]

    data = note.to_dict(
        current_user_id=user_id,
        include_place=True,
        _tags=_tags,
        _is_liked=_is_liked,
        _is_favorited=_is_favorited,
        _participation=_participation,
    )
    data["comments"] = note.get_comments(current_user_id=user_id)
    data["participants"] = note.get_participants()

    # 统一提交 view_count 更新（从 record_view 移出，减少写入阻塞）
    db.session.commit()
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
    post_type = clean_string(data.get("type"), "type", max_length=20)
    if post_type and post_type not in ("event", "forum"):
        return error_response("type 必须是 event 或 forum", 400)
    title = clean_string(data.get("title"), "title", max_length=100)
    content = clean_string(data.get("content"), "content", max_length=2000)
    urgency = clean_string(data.get("urgency"), "urgency", max_length=20)
    if urgency and urgency not in ("now", "long_term", "scheduled"):
        return error_response("urgency 必须是 now / long_term / scheduled", 400)
    tags = data.get("tags")
    if tags is not None and isinstance(tags, list):
        tags = [t.strip() for t in tags if isinstance(t, str) and t.strip()][:10]

    event_time = data.get("event_time")
    event_end_time = data.get("event_end_time")
    from datetime import datetime
    if event_time:
        try:
            event_time = datetime.fromisoformat(event_time.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return error_response("event_time 格式无效", 400)
    if event_end_time:
        try:
            event_end_time = datetime.fromisoformat(event_end_time.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return error_response("event_end_time 格式无效", 400)

    # scheduled 模式必须有开始+结束时间（编辑时也校验）
    effective_urgency = urgency if urgency is not None else note.urgency
    effective_start = event_time if event_time is not None else note.event_time
    effective_end = event_end_time if event_end_time is not None else note.event_end_time
    if effective_urgency == "scheduled":
        if not effective_start or not effective_end:
            return error_response("指定时间模式下必须提供开始和结束时间", 400)
        if effective_end <= effective_start:
            return error_response("结束时间必须晚于开始时间", 400)

    max_participants = int_range(data.get("slots"), "slots", min_value=2, max_value=100) if data.get("slots") is not None else None
    budget = clean_string(data.get("budget"), "budget", max_length=50)
    contact = clean_string(data.get("contact"), "contact", max_length=100)

    updated = notes.update_post(
        post_id,
        post_type=post_type,
        title=title,
        content=content,
        tags=tags,
        event_time=event_time,
        event_end_time=event_end_time,
        urgency=urgency,
        location=clean_string(data.get("location"), "location", max_length=50),
        location_name=clean_string(data.get("location_name"), "location_name", max_length=200),
        max_participants=max_participants,
        budget=budget,
        contact=contact,
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


@note_bp.route("/posts/<int:post_id>/favorite", methods=["POST"])
@jwt_required
@limiter.limit("60 per minute")
def toggle_favorite(post_id):
    """切换帖子收藏状态。"""
    notes = _ns()
    note = notes.get_post(post_id)
    if not note:
        return error_response("帖子不存在", 404, code="post_not_found")

    favorited = note.toggle_favorite(g.current_user_id)
    return jsonify({"favorited": favorited, "favorite_count": note.favorite_count})


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
    page_size = int_range(request.args.get("page_size", 20), "page_size", min_value=1, max_value=100)
    return jsonify(note.get_comments(
        page=page, page_size=page_size,
        current_user_id=notes.user_id,
    ))


@note_bp.route("/posts/<int:post_id>/comments/<int:comment_id>", methods=["DELETE"])
@jwt_required
@limiter.limit("30 per minute")
def delete_comment(post_id, comment_id):
    """删除评论（评论作者或帖主可操作）。"""
    notes = _ns()
    note = notes.get_post(post_id)
    if not note:
        return error_response("帖子不存在", 404, code="post_not_found")

    success = note.delete_comment(comment_id, g.current_user_id)
    if not success:
        return error_response("评论不存在或无权删除", 403, code="forbidden")

    return jsonify({"message": "已删除"})


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

    data = get_json_body(request)
    status = clean_string(data.get("status", "going"), "status", max_length=20) or "going"
    if status not in ("going", "interested"):
        return error_response("status 必须是 going 或 interested", 400)

    try:
        result = note.participate(g.current_user_id, status=status)
    except ValueError as e:
        return error_response(str(e), 400)
    return jsonify({
        "status": result,
        "participant_count": note.participant_total_count,
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


@note_bp.route("/me/post-comments", methods=["GET"])
@jwt_required
@limiter.limit("60 per minute")
def my_post_comments():
    """获取当前用户发表的所有帖子评论（含所属帖子信息）。"""
    from app.models import PostComment, EventPost
    comments = (
        PostComment.query
        .filter_by(user_id=g.current_user_id)
        .order_by(PostComment.created_at.desc())
        .limit(100)
        .all()
    )
    # 批量预加载帖子标题，避免 N+1 查询
    post_ids = [c.post_id for c in comments]
    posts_map = {}
    if post_ids:
        posts = EventPost.query.filter(EventPost.id.in_(post_ids)).all()
        posts_map = {p.id: p for p in posts}
    items = []
    for c in comments:
        post = posts_map.get(c.post_id)
        items.append({
            "id": c.id,
            "content": c.content,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "post_id": c.post_id,
            "post_title": post.title if post else "(已删除)",
            "parent_id": c.parent_id,
        })
    return jsonify({"items": items})


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
    page_size = int_range(request.args.get("page_size", 10), "page_size", min_value=1, max_value=100)

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
    from app.services.amap import inputtips, search_places

    keyword = clean_string(request.args.get("keyword"), "keyword", required=True, max_length=50)
    city = clean_string(request.args.get("city", "南京"), "city", max_length=30)
    location = request.args.get("location", "").strip() or None

    def _normalize_location(raw_location):
        if not raw_location:
            return None
        if isinstance(raw_location, dict):
            lng = str(raw_location.get("lng", "")).strip()
            lat = str(raw_location.get("lat", "")).strip()
            if not lng or not lat:
                return None
            return f"{lng},{lat}"
        value = str(raw_location).strip()
        if not value or "," not in value:
            return None
        return value

    tips = []
    seen = set()

    def _append_tip(name, address, district, loc):
        if not name or not loc:
            return
        dedupe_key = (name.strip().lower(), loc.strip())
        if dedupe_key in seen:
            return
        seen.add(dedupe_key)
        tips.append({
            "name": name,
            "address": address or "",
            "district": district or "",
            "location": loc,
        })

    try:
        data = inputtips(keyword, city=city, location=location)
        for t in data.get("tips", []):
            _append_tip(
                t.get("name", ""),
                t.get("address", ""),
                t.get("district", ""),
                _normalize_location(t.get("location")),
            )
    except Exception:
        data = {"tips": []}

    # 输入提示有时会返回无坐标项（例如“新街口”），这里用 POI 文本检索做兜底，
    # 保证前端始终拿到可用于发帖地图定位的坐标。
    if not tips:
        try:
            fallback = search_places(
                keyword,
                city=city,
                location=None,  # 不用前端固定坐标，避免把结果限制在某个小范围内
                page=1,
                page_size=12,
            )
            if str(fallback.get("status")) == "1":
                for poi in fallback.get("pois", []):
                    _append_tip(
                        poi.get("name", ""),
                        poi.get("address", ""),
                        poi.get("adname", ""),
                        _normalize_location(poi.get("location")),
                    )
        except Exception:
            if not data.get("tips"):
                return error_response("地点搜索服务暂时不可用", 502)

    return jsonify({"tips": tips})
