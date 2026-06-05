from datetime import datetime, timezone
import uuid

from app import db


def _utcnow():
    """返回当前UTC时间，替代已废弃的 datetime.utcnow。"""
    return datetime.now(timezone.utc)


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, index=True)
    username = db.Column(db.String(50), unique=True)
    password_hash = db.Column(db.String(255))
    email_verified = db.Column(db.Boolean, default=False, nullable=False)
    email_verified_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=_utcnow)

    # 用户画像（阶段二新增）
    bio = db.Column(db.String(300))            # 个人简介
    campus = db.Column(db.String(20))           # 校区：鼓楼/仙林/浦口/苏州
    tags = db.Column(db.String(500))           # JSON 数组: '["川菜","羽毛球","王者"]'
    avatar_url = db.Column(db.String(500))     # 头像链接（预留）
    updated_at = db.Column(db.DateTime, default=_utcnow, onupdate=_utcnow)

    reviews = db.relationship("Review", backref="user", lazy=True)
    likes = db.relationship("Like", backref="user", lazy=True)
    favorites = db.relationship("Favorite", backref="user", lazy=True)
    conversation_messages = db.relationship("ConversationMessage", backref="user", lazy=True)
    email_verification_tokens = db.relationship("EmailVerificationToken", backref="user", lazy=True)
    password_reset_tokens = db.relationship("PasswordResetToken", backref="user", lazy=True)


class Place(db.Model):
    """吃喝玩乐场所（原 Restaurant 模型重构）。

    融合高德地图 POI 数据与用户 UGC 内容。
    category 字段存储高德 POI 分类码（如 050100=中餐厅）。
    """
    __tablename__ = "places"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    address = db.Column(db.String(200))
    location = db.Column(db.String(50))        # lng,lat 格式
    poi_id = db.Column(db.String(100))
    category = db.Column(db.String(50))        # 高德 POI 分类码
    photos = db.Column(db.String(1000))        # JSON 数组: 图片 URL 列表
    avg_rating = db.Column(db.Float)           # 缓存平均评分
    added_by = db.Column(db.Integer, db.ForeignKey("users.id"))
    amap_updated_at = db.Column(db.DateTime)   # 高德数据最后同步时间
    created_at = db.Column(db.DateTime, default=_utcnow)

    reviews = db.relationship("Review", backref="place", lazy=True)
    likes = db.relationship("Like", backref="place", lazy=True)
    favorites = db.relationship("Favorite", backref="place", lazy=True)


class Review(db.Model):
    __tablename__ = "reviews"

    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.String(500), nullable=False)
    rating = db.Column(db.Integer)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    place_id = db.Column(db.Integer, db.ForeignKey("places.id"))
    created_at = db.Column(db.DateTime, default=_utcnow)


class Like(db.Model):
    __tablename__ = "likes"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    place_id = db.Column(db.Integer, db.ForeignKey("places.id"))
    created_at = db.Column(db.DateTime, default=_utcnow)

    __table_args__ = (db.UniqueConstraint("user_id", "place_id", name="_user_place_like_uc"),)


class Favorite(db.Model):
    __tablename__ = "favorites"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    place_id = db.Column(db.Integer, db.ForeignKey("places.id"))
    created_at = db.Column(db.DateTime, default=_utcnow)

    __table_args__ = (db.UniqueConstraint("user_id", "place_id", name="_user_place_fav_uc"),)


class ConversationMessage(db.Model):
    __tablename__ = "conversation_messages"

    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.String(36), index=True, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), index=True, nullable=False)
    role = db.Column(db.String(20), nullable=False)
    content = db.Column(db.String(1000), nullable=False)
    created_at = db.Column(db.DateTime, default=_utcnow, index=True)

    @staticmethod
    def new_session_id():
        return str(uuid.uuid4())


class EmailVerificationToken(db.Model):
    __tablename__ = "email_verification_tokens"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), index=True, nullable=False)
    token_hash = db.Column(db.String(64), unique=True, index=True, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    used_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=_utcnow)


class PasswordResetToken(db.Model):
    __tablename__ = "password_reset_tokens"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), index=True, nullable=False)
    token_hash = db.Column(db.String(64), unique=True, index=True, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    used_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=_utcnow)


class EmailVerificationCode(db.Model):
    __tablename__ = "email_verification_codes"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), index=True, nullable=False)
    purpose = db.Column(db.String(30), index=True, nullable=False)
    code_hash = db.Column(db.String(64), nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    used_at = db.Column(db.DateTime)
    attempt_count = db.Column(db.Integer, default=0, nullable=False)
    created_at = db.Column(db.DateTime, default=_utcnow, index=True)


class RevokedToken(db.Model):
    __tablename__ = "revoked_tokens"

    id = db.Column(db.Integer, primary_key=True)
    jti = db.Column(db.String(36), unique=True, index=True, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), index=True, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    revoked_at = db.Column(db.DateTime, default=_utcnow, nullable=False)


# ═══════════════════════════════════════════════════════════════
# 阶段二/三新增：标签系统、帖子、互动、智能匹配
# ═══════════════════════════════════════════════════════════════

class Tag(db.Model):
    """标签字典。

    三类标签（category）：
    - food:     美食口味（川菜、火锅、日料、咖啡…）
    - activity: 活动类型（羽毛球、桌游、爬山、K歌、跑步…）
    - identity: 身份社群（研一、大一、计算机系、社恐、考研党…）

    标签由 NoteSystem 在首次使用时自动创建，usage_count 记录热度。
    """
    __tablename__ = "tags"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(30), unique=True, nullable=False, index=True)
    category = db.Column(db.String(20), nullable=False, index=True)
    usage_count = db.Column(db.Integer, default=0, nullable=False)
    created_at = db.Column(db.DateTime, default=_utcnow)


class UserTag(db.Model):
    """用户自选的兴趣标签。

    NoteSystem 做搭子匹配时，靠这张表计算两个用户之间的标签重叠度。
    """
    __tablename__ = "user_tags"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    tag_id = db.Column(db.Integer, db.ForeignKey("tags.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=_utcnow)

    __table_args__ = (
        db.UniqueConstraint("user_id", "tag_id", name="_user_tag_uc"),
    )

    tag = db.relationship("Tag", lazy="joined")


class EventPost(db.Model):
    """事件/搭子帖子 —— 整个帖子系统的唯一帖子表。

    type 字段：
    - 'event': 活动事件帖 —— 有时间、有地点、可报名参加
    - 'forum': 搭子招募帖 —— 找同好，不强制关联场所或时间

    is_official 标记"官方推荐"（高德 POI 自动生成或管理员推荐）。
    hot_score 在每次互动（点赞/评论/报名）时由 NoteSystem 重算更新。
    """
    __tablename__ = "event_posts"

    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(20), nullable=False, default="forum", index=True)
    title = db.Column(db.String(100), nullable=False)
    content = db.Column(db.String(2000), nullable=False)
    cover_image = db.Column(db.String(500))                          # 封面图 URL（可选）
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    place_id = db.Column(db.Integer, db.ForeignKey("places.id"), nullable=True, index=True)
    event_time = db.Column(db.DateTime)                              # 活动时间（urgency=scheduled 时必填）
    urgency = db.Column(db.String(20))                               # 'now' / 'long_term' / 'scheduled' / None
    location = db.Column(db.String(50))                              # "lng,lat"
    location_name = db.Column(db.String(200))                        # 人类可读的地点名
    max_participants = db.Column(db.Integer, default=1)              # 招募人数上限
    budget = db.Column(db.String(50))                                # 预算（独立于标签）
    contact = db.Column(db.String(100))                              # 联系方式（微信/QQ/手机）
    is_official = db.Column(db.Boolean, default=False, nullable=False)
    # 计数缓存（避免每次列表查询都 JOIN 三张表）
    view_count = db.Column(db.Integer, default=0, nullable=False)
    like_count = db.Column(db.Integer, default=0, nullable=False)
    comment_count = db.Column(db.Integer, default=0, nullable=False)
    participant_count = db.Column(db.Integer, default=0, nullable=False)
    # 热度分：view*1 + like*3 + comment*5 + participant*10，再乘以时间衰减因子
    hot_score = db.Column(db.Float, default=0.0, nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=_utcnow, index=True)
    updated_at = db.Column(db.DateTime, default=_utcnow, onupdate=_utcnow)

    # 关系
    user = db.relationship("User", lazy="joined")
    place = db.relationship("Place", lazy="joined")


class PostTag(db.Model):
    """帖子-标签关联表。

    每条记录表示某个帖子被打上了某个标签。
    例如 EventPost #3 被打上了「羽毛球」和「仙林」两个标签 → 两行记录。
    """
    __tablename__ = "post_tags"

    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey("event_posts.id"), nullable=False, index=True)
    tag_id = db.Column(db.Integer, db.ForeignKey("tags.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=_utcnow)

    __table_args__ = (
        db.UniqueConstraint("post_id", "tag_id", name="_post_tag_uc"),
    )

    tag = db.relationship("Tag", lazy="joined")
    post = db.relationship("EventPost")  # 允许 PostTag(post=event_post) 延迟解析 FK


class PostComment(db.Model):
    """帖子评论。

    parent_id 支持一层嵌套回复：parent_id 为空 → 顶级评论，
    parent_id 指向另一条评论 → 回复。
    """
    __tablename__ = "post_comments"

    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey("event_posts.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    content = db.Column(db.String(500), nullable=False)
    parent_id = db.Column(db.Integer, db.ForeignKey("post_comments.id"), nullable=True)
    created_at = db.Column(db.DateTime, default=_utcnow, index=True)

    user = db.relationship("User", lazy="joined")


class PostLike(db.Model):
    """帖子点赞。

    user_id + post_id 唯一约束，重复请求触发 toggle（点一下赞，再点一下取消）。
    """
    __tablename__ = "post_likes"

    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey("event_posts.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=_utcnow)

    __table_args__ = (
        db.UniqueConstraint("user_id", "post_id", name="_user_post_like_uc"),
    )


class EventParticipant(db.Model):
    """用户报名/参与活动记录。

    status: 'going'（确定参加）/ 'interested'（感兴趣）。
    """
    __tablename__ = "event_participants"

    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey("event_posts.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="interested")
    created_at = db.Column(db.DateTime, default=_utcnow)

    __table_args__ = (
        db.UniqueConstraint("user_id", "post_id", name="_user_event_participant_uc"),
    )

    user = db.relationship("User", lazy="joined")


class MatchRecord(db.Model):
    """智能匹配推荐记录。

    系统为用户推荐帖子时写入此表，记录匹配分数和理由。
    用户的 feedback 字段可用于优化推荐算法。
    """
    __tablename__ = "match_records"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    post_id = db.Column(db.Integer, db.ForeignKey("event_posts.id"), nullable=False)
    score = db.Column(db.Float, nullable=False)                     # 匹配分数 0~100
    reason = db.Column(db.String(300))                              # 理由摘要
    feedback = db.Column(db.String(20))                             # liked / dismissed / ignored
    created_at = db.Column(db.DateTime, default=_utcnow, index=True)
