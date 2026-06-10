# app/db_utils.py
from sqlalchemy import inspect, text

from app import db


def ensure_user_auth_schema():
    """为旧版 SQLite users 表补齐登录字段。

    db.create_all() 只会创建不存在的表，不会修改已有表结构。
    早期版本 users 表没有 email/password_hash，这里做轻量兼容。
    """
    inspector = inspect(db.engine)
    if "users" not in inspector.get_table_names():
        return

    existing_columns = {column["name"] for column in inspector.get_columns("users")}

    if "email" not in existing_columns:
        db.session.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR(255)"))

    if "password_hash" not in existing_columns:
        db.session.execute(text("ALTER TABLE users ADD COLUMN password_hash VARCHAR(255)"))

    if "email_verified" not in existing_columns:
        db.session.execute(text("ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT 0 NOT NULL"))

    if "email_verified_at" not in existing_columns:
        db.session.execute(text("ALTER TABLE users ADD COLUMN email_verified_at DATETIME"))

    if "campus" not in existing_columns:
        db.session.execute(text("ALTER TABLE users ADD COLUMN campus VARCHAR(20)"))

    if "bio" not in existing_columns:
        db.session.execute(text("ALTER TABLE users ADD COLUMN bio VARCHAR(300)"))

    if "tags" not in existing_columns:
        db.session.execute(text("ALTER TABLE users ADD COLUMN tags VARCHAR(500)"))

    if "avatar_url" not in existing_columns:
        db.session.execute(text("ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500)"))

    if "cover_url" not in existing_columns:
        db.session.execute(text("ALTER TABLE users ADD COLUMN cover_url VARCHAR(500)"))

    if "bubble_style" not in existing_columns:
        db.session.execute(text("ALTER TABLE users ADD COLUMN bubble_style VARCHAR(50) DEFAULT 'atlas-classic' NOT NULL"))

    db.session.execute(
        text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email)")
    )
    db.session.commit()


def ensure_post_social_schema():
    """为旧版 SQLite 帖子表补齐收藏相关字段。"""
    inspector = inspect(db.engine)
    table_names = set(inspector.get_table_names())

    if "event_posts" in table_names:
        post_columns = {column["name"] for column in inspector.get_columns("event_posts")}
        if "event_end_time" not in post_columns:
            db.session.execute(
                text("ALTER TABLE event_posts ADD COLUMN event_end_time DATETIME")
            )
        if "favorite_count" not in post_columns:
            db.session.execute(
                text("ALTER TABLE event_posts ADD COLUMN favorite_count INTEGER DEFAULT 0 NOT NULL")
            )

    if "post_favorites" not in table_names:
        db.session.execute(text(
            "CREATE TABLE post_favorites ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "post_id INTEGER NOT NULL, "
            "user_id INTEGER NOT NULL, "
            "created_at DATETIME, "
            "CONSTRAINT _user_post_favorite_uc UNIQUE (user_id, post_id), "
            "FOREIGN KEY(post_id) REFERENCES event_posts(id), "
            "FOREIGN KEY(user_id) REFERENCES users(id)"
            ")"
        ))

    db.session.execute(
        text("CREATE INDEX IF NOT EXISTS ix_post_favorites_post_id ON post_favorites (post_id)")
    )
    db.session.commit()


def initialize_database():
    """创建缺失的数据表，并执行当前 MVP 阶段的轻量兼容迁移。"""
    db.create_all()
    ensure_user_auth_schema()
    ensure_post_social_schema()
