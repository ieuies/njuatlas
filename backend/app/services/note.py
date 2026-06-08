"""
帖子系统服务层 —— SingleNote + NoteSystem。

SingleNote   ：包装一条 EventPost，对外暴露业务语义（点赞、评论、报名、序列化）。
NoteSystem   ：帖子集合的检索与管理（创建、多维筛选、标签维护）。

热度计算与过期过滤委托给 app.services.scoring 模块。
"""

import json
import time as _time

from sqlalchemy.orm import selectinload

from app import db
from app.models import (
    EventPost,
    EventParticipant,
    PostComment,
    PostLike,
    PostTag,
    Tag,
    UserTag,
)
from app.services.scoring import compute_hot, filter_active


# ── 辅助 ───────────────────────────────────────────────────────
def _utcnow():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc)


# ═══════════════════════════════════════════════════════════════
# SingleNote —— 单条帖子的业务对象
# ═══════════════════════════════════════════════════════════════

class SingleNote:
    """包装一条 EventPost 的业务对象。

    构造函数接受两类参数：
    1. 传入已有的 ORM 实例 —— 包装它，用于后续编辑 / 操作：
           note = SingleNote(model=existing_post)

    2. 传入字段值 —— 创建新的 ORM 实例（尚未入库，需手动调 .save()）：
           note = SingleNote(title="xx", content="xx", type="forum")
           note.save()

    属性访问：通过 __getattr__ 把未知属性自动转发到内部 ORM 模型，
    所以 note.title / note.id / note.hot_score 都能直接用。
    """

    def __init__(self, model=None, **kwargs):
        if model is not None:
            # 包装已有 ORM 实例
            self._m = model
            self._is_new = False
        else:
            # 根据传入字段新建 ORM 实例（tags 支持 list → JSON 字符串转换）
            tags_raw = kwargs.pop("tags", [])
            if isinstance(tags_raw, str):
                tags_raw = json.loads(tags_raw) if tags_raw.startswith("[") else []
            self._m = EventPost(**kwargs)
            self._m.tags_raw = tags_raw  # 暂存，等 save() 时写入 post_tags 表
            self._is_new = True

        # 暂存待写入的标签名列表
        self._pending_tags = getattr(self._m, "tags_raw", [])

    # ── 属性自动转发 ──────────────────────────────────────────
    def __getattr__(self, name):
        """未定义的属性自动查内部 ORM 模型，避免逐一手写转发。"""
        if name.startswith("_"):
            raise AttributeError(name)
        return getattr(self._m, name)

    # ── 持久化 ────────────────────────────────────────────────
    def save(self):
        """将帖子写入数据库（新建或更新），并同步 post_tags 关联。

        优化：利用 PostTag.post relationship 延迟解析 FK，避免中间 flush，
        将 INSERT event_posts + INSERT tags + INSERT post_tags 合并为一次 commit。
        """
        compute_hot(self._m)
        db.session.add(self._m)

        # 同步标签：仅在 _pending_tags 非空时处理（新建帖子或明确要改标签时）
        if self._pending_tags:
            self._sync_tags(self._pending_tags)
            self._pending_tags = []

        db.session.commit()
        _clear_search_cache()
        self._is_new = False
        return self

    def _sync_tags(self, tag_names):
        """将标签名列表写入 post_tags 表（批量优化版）。

        - 新帖：直接创建关联，所有标签 usage_count +1
        - 编辑帖：先记下旧标签 → 删旧关联 → 新标签加计数，移除的旧标签减计数
        所有操作在同一事务中，save() 末尾一次 commit 即可。
        """
        tag_names = [n.strip() for n in tag_names if n.strip()]
        if not tag_names:
            return

        tag_set = set(tag_names)

        # 1. 处理旧关联（仅编辑已有帖子时需要）
        old_tag_names = set()
        if not self._is_new:
            # 记下旧标签名（用于后续计数调整）
            old_tags = PostTag.query.filter_by(post_id=self._m.id).all()
            old_tag_names = {pt.tag.name for pt in old_tags if pt.tag}
            # 删除旧关联
            from sqlalchemy import delete
            db.session.execute(delete(PostTag).where(PostTag.post_id == self._m.id))

        # 2. 批量查找已有标签（1 次查询替代 N 次）
        existing_tags = {t.name: t for t in Tag.query.filter(Tag.name.in_(tag_names)).all()}

        # 3. 批量创建缺失标签
        for name in tag_names:
            if name not in existing_tags:
                t = Tag(name=name, category="unknown")
                db.session.add(t)
                existing_tags[name] = t

        # 4. 批量写入 PostTag 关联 + 调整 usage_count
        #    新增的标签 +1，移除的旧标签 -1，保留的不变
        added = tag_set - old_tag_names
        removed = old_tag_names - tag_set
        for name in tag_names:
            tag = existing_tags[name]
            db.session.add(PostTag(post=self._m, tag=tag))
            if name in added:
                tag.usage_count = (tag.usage_count or 0) + 1
        for name in removed:
            t = Tag.query.filter_by(name=name).first()
            if t:
                t.usage_count = max(0, (t.usage_count or 0) - 1)

        # 缓存已解析的标签名，供 to_dict 复用
        self._cached_tag_names = tag_names

    def delete(self):
        """删除帖子及其所有关联数据。"""
        post_id = self._m.id
        PostTag.query.filter_by(post_id=post_id).delete(synchronize_session=False)
        PostComment.query.filter_by(post_id=post_id).delete(synchronize_session=False)
        PostLike.query.filter_by(post_id=post_id).delete(synchronize_session=False)
        EventParticipant.query.filter_by(post_id=post_id).delete(synchronize_session=False)
        db.session.delete(self._m)
        db.session.commit()
        _clear_search_cache()

    # ── 权限 ──────────────────────────────────────────────────
    def can_edit(self, user_id):
        return self._m.user_id == user_id

    # ── 互动 ──────────────────────────────────────────────────
    def toggle_like(self, user_id):
        """切换点赞状态。返回 True=已赞, False=已取消。"""
        existing = PostLike.query.filter_by(post_id=self._m.id, user_id=user_id).first()
        if existing:
            db.session.delete(existing)
            self._m.like_count = max(0, (self._m.like_count or 0) - 1)
            compute_hot(self._m)
            db.session.commit()
            _clear_search_cache()
            return False
        db.session.add(PostLike(post_id=self._m.id, user_id=user_id))
        self._m.like_count = (self._m.like_count or 0) + 1
        compute_hot(self._m)
        db.session.commit()
        _clear_search_cache()
        return True

    def add_comment(self, user_id, content, parent_id=None):
        """添加一条评论。返回新评论的 ORM 对象。"""
        comment = PostComment(
            post_id=self._m.id,
            user_id=user_id,
            content=content,
            parent_id=parent_id,
        )
        db.session.add(comment)
        self._m.comment_count = (self._m.comment_count or 0) + 1
        compute_hot(self._m)
        db.session.commit()
        _clear_search_cache()
        return comment

    def get_comments(self, page=1, page_size=20, current_user_id=None):
        """获取这条帖子的顶级评论列表（含嵌套回复）。"""
        top = (
            PostComment.query
            .filter_by(post_id=self._m.id, parent_id=None)
            .order_by(PostComment.created_at.asc())
            .paginate(page=page, per_page=page_size, error_out=False)
        )
        replies = {}
        if top.items:
            comment_ids = [c.id for c in top.items]
            all_replies = (
                PostComment.query
                .filter(PostComment.parent_id.in_(comment_ids))
                .order_by(PostComment.created_at.asc())
                .all()
            )
            for r in all_replies:
                replies.setdefault(r.parent_id, []).append(r)
        return {
            "items": [
                {
                    "id": c.id,
                    "user_id": c.user_id,
                    "username": c.user.username if c.user else "",
                    "content": c.content,
                    "created_at": c.created_at.isoformat() if c.created_at else None,
                    "is_owner": (current_user_id is not None and c.user_id == current_user_id),
                    "replies": [
                        {
                            "id": r.id,
                            "user_id": r.user_id,
                            "username": r.user.username if r.user else "",
                            "content": r.content,
                            "created_at": r.created_at.isoformat() if r.created_at else None,
                            "is_owner": (current_user_id is not None and r.user_id == current_user_id),
                        }
                        for r in replies.get(c.id, [])
                    ],
                }
                for c in top.items
            ],
            "page": page,
            "page_size": page_size,
            "total": top.total,
            "has_next": top.has_next,
        }

    def delete_comment(self, comment_id, user_id):
        """删除评论。仅评论作者或帖主可操作。返回 True=成功, False=无权。"""
        comment = PostComment.query.filter_by(id=comment_id, post_id=self._m.id).first()
        if not comment:
            return False
        # 评论作者或帖子作者均可删除
        if comment.user_id != user_id and self._m.user_id != user_id:
            return False
        # 如果是父评论，同时删除其所有子回复
        child_replies = PostComment.query.filter_by(parent_id=comment.id).all()
        for child in child_replies:
            db.session.delete(child)
            self._m.comment_count = max(0, (self._m.comment_count or 0) - 1)
        db.session.delete(comment)
        self._m.comment_count = max(0, (self._m.comment_count or 0) - 1)
        compute_hot(self._m)
        db.session.commit()
        _clear_search_cache()
        return True

    def participate(self, user_id, status="going"):
        """切换用户的参与状态。再次调用同状态则取消。"""
        # 发起者不能报名自己的活动
        if user_id == self._m.user_id:
            raise ValueError("你不能报名自己发布的活动")

        existing = EventParticipant.query.filter_by(
            post_id=self._m.id, user_id=user_id
        ).first()
        if existing and existing.status == status:
            db.session.delete(existing)
            self._m.participant_count = max(0, (self._m.participant_count or 0) - 1)
            compute_hot(self._m)
            db.session.commit()
            _clear_search_cache()
            return None  # 已取消
        if existing:
            existing.status = status
        else:
            # 报名人数不能超过上限
            current_count = self._m.participant_count or 0
            max_slots = self._m.max_participants or 1
            if current_count >= max_slots:
                raise ValueError(f"报名人数已满（{max_slots}/{max_slots}）")
            db.session.add(EventParticipant(
                post_id=self._m.id, user_id=user_id, status=status
            ))
            self._m.participant_count = current_count + 1
        compute_hot(self._m)
        db.session.commit()
        _clear_search_cache()
        return status

    def get_participants(self):
        """获取报名用户列表（含发起人标记）。"""
        records = EventParticipant.query.filter_by(post_id=self._m.id).all()
        return [
            {
                "user_id": r.user_id,
                "username": r.user.username if r.user else "",
                "status": r.status,
                "is_organizer": r.user_id == self._m.user_id,
            }
            for r in records
        ]

    # ── 浏览计数 ──────────────────────────────────────────────
    def record_view(self):
        """浏览数 +1（不在此处 commit，由路由层统一提交以减少写入阻塞）。"""
        self._m.view_count = (self._m.view_count or 0) + 1
        compute_hot(self._m)

    # ── 序列化 ────────────────────────────────────────────────
    def to_dict(self, current_user_id=None, include_place=False,
                _tags=None, _is_liked=None, _participation=None):
        """输出为 API 可用的 dict。

        current_user_id 用于填充 is_liked / is_participated 等当前用户状态。

        批量预加载参数（由 NoteSystem.search 传入，避免 N+1 查询）：
        - _tags:          预加载的标签名列表，传入时跳过 PostTag 查询
        - _is_liked:      预加载的点赞状态，传入时跳过 PostLike 查询
        - _participation: 预加载的报名状态，传入时跳过 EventParticipant 查询
        """
        m = self._m
        # 标签：优先级 _tags > _cached_tag_names > 数据库查询
        if _tags is not None:
            tag_names = _tags
        elif hasattr(self, '_cached_tag_names') and self._cached_tag_names is not None:
            tag_names = list(self._cached_tag_names)
        else:
            tag_names = [pt.tag.name for pt in PostTag.query.filter_by(post_id=m.id).all() if pt.tag]

        result = {
            "id": m.id,
            "type": m.type,
            "title": m.title,
            "content": m.content,
            "cover_image": m.cover_image,
            "user_id": m.user_id,
            "username": m.user.username if m.user else "",
            "place_id": m.place_id,
            "event_time": m.event_time.isoformat() if m.event_time else None,
            "urgency": m.urgency,
            "location": m.location,
            "location_name": m.location_name,
            "max_participants": m.max_participants,
            "budget": m.budget,
            "contact": m.contact,
            "tags": tag_names,
            "is_official": m.is_official,
            "view_count": m.view_count or 0,
            "like_count": m.like_count or 0,
            "comment_count": m.comment_count or 0,
            "participant_count": m.participant_count or 0,
            "hot_score": m.hot_score,
            "created_at": m.created_at.isoformat() if m.created_at else None,
            "updated_at": m.updated_at.isoformat() if m.updated_at else None,
        }

        # 当前用户的状态（优先用预加载值，避免子查询）
        if current_user_id:
            if _is_liked is not None:
                result["is_liked"] = _is_liked
            else:
                result["is_liked"] = PostLike.query.filter_by(
                    post_id=m.id, user_id=current_user_id
                ).first() is not None
            result["is_owner"] = m.user_id == current_user_id
            if _participation is not None:
                result["participation_status"] = _participation
            else:
                part = EventParticipant.query.filter_by(
                    post_id=m.id, user_id=current_user_id
                ).first()
                result["participation_status"] = part.status if part else None

        # 可选：附带场所信息
        if include_place and m.place:
            result["place"] = {
                "id": m.place.id,
                "name": m.place.name,
                "address": m.place.address,
                "location": m.place.location,
                "category": m.place.category,
            }

        return result


# ═══════════════════════════════════════════════════════════════
# NoteSystem —— 帖子集合管理系统
# ═══════════════════════════════════════════════════════════════

# ── 帖子列表缓存（减少云数据库查询延迟）──
_SEARCH_CACHE = {}       # {cache_key: (timestamp, result)}
_SEARCH_CACHE_TTL = 15   # 缓存 15 秒（足够覆盖首次加载 + 分类切换）

def _clear_search_cache():
    """写操作后清除搜索缓存，确保数据一致性。"""
    _SEARCH_CACHE.clear()

class NoteSystem:
    """帖子系统的统一入口。

    每个请求创建一个实例，绑定当前用户：
        notes = NoteSystem(user_id=g.current_user_id)

    使用方式：
        # 创建帖子
        post = notes.create_post(title="找饭搭子", content="...", tags=["川菜","仙林"])

        # 检索
        result = notes.search(tags=["川菜"], sort="hot", page=1)

        # 获取单帖
        note = notes.get_post(post_id=1)
        note.toggle_like(user_id=...)
    """

    def __init__(self, user_id=None):
        self.user_id = user_id

    # ── 工厂：创建 SingleNote ─────────────────────────────────
    def create_post(self, *, title, content, post_type="forum", tags=None,
                    place_id=None, event_time=None, urgency=None,
                    location=None, location_name=None,
                    max_participants=None, budget=None, contact=None,
                    cover_image=None, is_official=False):
        """创建一个新帖子，返回 SingleNote 包装对象。

        调用方拿到 SingleNote 后可以继续操作：
            note = notes.create_post(...)
            data = note.to_dict(current_user_id=...)
        """
        note = SingleNote(
            type=post_type,
            title=title,
            content=content,
            user_id=self.user_id,
            place_id=place_id,
            event_time=event_time,
            urgency=urgency,
            location=location,
            location_name=location_name,
            max_participants=max_participants,
            budget=budget,
            contact=contact,
            cover_image=cover_image,
            is_official=is_official,
        )
        note._pending_tags = tags or []
        note.save()
        return note

    # ── 获取单帖 ──────────────────────────────────────────────
    def get_post(self, post_id):
        """按 ID 获取 SingleNote，不存在返回 None。"""
        model = EventPost.query.get(post_id)
        if not model:
            return None
        return SingleNote(model=model)

    # ── 更新帖子 ──────────────────────────────────────────────
    def update_post(self, post_id, *, post_type=None, title=None, content=None, tags=None,
                    event_time=None, urgency=None, location=None, location_name=None,
                    max_participants=None, budget=None, contact=None, cover_image=None):
        """更新帖子字段（仅帖主可操作，调用方需自己校验权限）。"""
        note = self.get_post(post_id)
        if not note:
            return None
        if title is not None:
            note._m.title = title
        if content is not None:
            note._m.content = content
        if event_time is not None:
            note._m.event_time = event_time
        if post_type is not None:
            note._m.type = post_type
        if urgency is not None:
            note._m.urgency = urgency
        # 如果从 event 改为 forum，清空活动时间
        if note._m.type == "forum":
            note._m.event_time = None
        if location is not None:
            note._m.location = location
        if location_name is not None:
            note._m.location_name = location_name
        if max_participants is not None:
            note._m.max_participants = max_participants
        if budget is not None:
            note._m.budget = budget
        if contact is not None:
            note._m.contact = contact
        if cover_image is not None:
            note._m.cover_image = cover_image
        if tags is not None:
            note._pending_tags = tags
        note.save()
        return note

    # ── 多维搜索 ──────────────────────────────────────────────
    def search(self, *, type=None, tags=None, place_id=None,
               sort="hot", lat=None, lng=None, radius=5000,
               user_id=None, page=1, page_size=20):
        """帖子列表多维筛选。

        参数：
        - type:      'event' / 'forum'，不传则全类型
        - tags:      标签名列表，如 ['羽毛球','仙林']，AND 逻辑
        - place_id:  只查关联了某个场所的帖子
        - sort:      'hot'（热度）/ 'new'（最新）/ 'nearby'（距离，需传 lat/lng）
        - lat, lng:  用户当前坐标，用于 nearby 排序
        - radius:    地理半径（米），仅当 sort='nearby' 时生效
        - user_id:   只看某用户发的帖
        - page, page_size: 分页
        """
        # ── 缓存：相同查询参数 15 秒内直接返回，避免云数据库延迟 ──
        cache_key = json.dumps([type, tags, place_id, sort, lat, lng, radius, user_id, page, page_size], sort_keys=True, default=str)
        now = _time.time()
        if cache_key in _SEARCH_CACHE:
            cached_at, cached_result = _SEARCH_CACHE[cache_key]
            if now - cached_at < _SEARCH_CACHE_TTL:
                return cached_result

        q = EventPost.query

        # 类型筛选
        if type:
            q = q.filter(EventPost.type == type)

        # 标签筛选：AND 逻辑（帖子必须同时拥有传入的所有标签）
        # 批量查询标签名 → ID 映射，避免 N 次 Tag 查询
        if tags:
            tag_rows = Tag.query.filter(Tag.name.in_(tags)).all()
            for tag in tag_rows:
                sub = PostTag.query.filter_by(tag_id=tag.id).with_entities(PostTag.post_id).subquery()
                q = q.filter(EventPost.id.in_(sub))

        # 关联场所
        if place_id is not None:
            q = q.filter(EventPost.place_id == place_id)

        # 只看某用户
        if user_id is not None:
            q = q.filter(EventPost.user_id == user_id)

        # 过滤已过期帖子（立即超时 / 指定时间已过）
        q = filter_active(q, EventPost)

        # 排序
        if sort == "new":
            q = q.order_by(EventPost.created_at.desc())
        elif sort == "nearby":
            # 附近排序：先用 place_id 做地理粗筛，后续可加 GeoHash 优化
            q = q.order_by(EventPost.hot_score.desc())  # 暂时退化为热度排序
        elif sort == "random":
            from sqlalchemy import func
            q = q.order_by(func.random())
        else:
            # 默认 hot
            q = q.order_by(EventPost.hot_score.desc())

        # 预加载用户信息，避免 to_dict() 中 m.user 触发 N 次懒查询
        q = q.options(selectinload(EventPost.user))
        # 用 limit/offset 代替 paginate()，跳过不必要的 COUNT 查询
        q = q.limit(page_size).offset((page - 1) * page_size)
        rows = q.all()

        # ── 批量预加载关联数据，避免 N+1 查询 ──────────────────
        post_ids = [m.id for m in rows]

        # 标签：1 次查询取所有帖子的标签名
        tags_map = {}  # {post_id: [tag_name, ...]}
        if post_ids:
            pt_rows = (
                PostTag.query
                .filter(PostTag.post_id.in_(post_ids))
                .all()
            )
            for pt in pt_rows:
                if pt.tag:
                    tags_map.setdefault(pt.post_id, []).append(pt.tag.name)

        # 点赞 & 报名状态：仅当已登录时查询
        likes_set = set()      # {post_id, ...}
        parts_map = {}         # {post_id: status}
        if post_ids and self.user_id:
            likes = (
                PostLike.query
                .filter(PostLike.post_id.in_(post_ids), PostLike.user_id == self.user_id)
                .all()
            )
            likes_set = {l.post_id for l in likes}

            parts = (
                EventParticipant.query
                .filter(EventParticipant.post_id.in_(post_ids),
                        EventParticipant.user_id == self.user_id)
                .all()
            )
            parts_map = {p.post_id: p.status for p in parts}

        items = []
        for model in rows:
            note = SingleNote(model=model)
            items.append(note.to_dict(
                current_user_id=self.user_id,
                _tags=tags_map.get(model.id, []),
                _is_liked=model.id in likes_set if self.user_id else None,
                _participation=parts_map.get(model.id) if self.user_id else None,
            ))

        result = {
            "items": items,
            "page": page,
            "page_size": page_size,
        }
        _SEARCH_CACHE[cache_key] = (now, result)
        return result

    # ── 场所关联帖子 ──────────────────────────────────────────
    def posts_for_place(self, place_id, page=1, page_size=10):
        """获取某个场所下的全部 UGC 帖子。"""
        return self.search(place_id=place_id, sort="hot", page=page, page_size=page_size)

    # ── 标签管理 ──────────────────────────────────────────────
    @staticmethod
    def get_or_create_tag(name, category="unknown"):
        """查找或创建标签。返回 Tag ORM 对象。"""
        name = name.strip()
        if not name:
            return None
        tag = Tag.query.filter_by(name=name).first()
        if not tag:
            tag = Tag(name=name, category=category)
            db.session.add(tag)
            db.session.commit()
        return tag

    @staticmethod
    def list_tags(category=None):
        """列出所有标签，可按 category 筛选，按 usage_count 降序。"""
        q = Tag.query
        if category:
            q = q.filter_by(category=category)
        tags = q.order_by(Tag.usage_count.desc()).all()
        return [{"id": t.id, "name": t.name, "category": t.category,
                 "usage_count": t.usage_count} for t in tags]

    # ── 用户标签 ──────────────────────────────────────────────
    def set_user_tags(self, tag_names):
        """批量设置当前用户的兴趣标签（替换旧标签）。"""
        if not self.user_id:
            return
        UserTag.query.filter_by(user_id=self.user_id).delete()
        for name in tag_names:
            tag = self.get_or_create_tag(name.strip())
            if tag:
                db.session.add(UserTag(user_id=self.user_id, tag_id=tag.id))
        db.session.commit()

    def get_user_tags(self):
        """获取当前用户的兴趣标签列表。"""
        if not self.user_id:
            return []
        rows = UserTag.query.filter_by(user_id=self.user_id).all()
        return [{"id": r.tag.id, "name": r.tag.name, "category": r.tag.category} for r in rows if r.tag]

