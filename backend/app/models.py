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
