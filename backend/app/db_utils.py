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

    db.session.execute(
        text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email)")
    )
    db.session.commit()


def initialize_database():
    """创建缺失的数据表，并执行当前 MVP 阶段的轻量兼容迁移。"""
    db.create_all()
    ensure_user_auth_schema()
