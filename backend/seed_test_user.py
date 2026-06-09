"""本地测试用：创建已验证邮箱的测试账号，便于双端联调消息功能。

仅用于本地开发，请勿在生产环境运行。
用法：在 backend 目录下执行  python seed_test_user.py
"""
from datetime import datetime, timezone

from sqlalchemy import inspect, text
from werkzeug.security import generate_password_hash

from app import create_app, db
from app.db_utils import initialize_database
from app.models import User

TEST_USERS = [
    {
        "email": "nailong@njuatlas.local",
        "username": "奶龙",
        "password": "test1234",
    },
    {
        "email": "naiwa@njuatlas.local",
        "username": "奶蛙",
        "password": "test1234",
    },
]

app = create_app()


def _ensure_users_campus_column():
    """旧版本地 SQLite 的 users 表缺少 campus 列，补齐以匹配当前模型。"""
    inspector = inspect(db.engine)
    if "users" not in inspector.get_table_names():
        return
    columns = {c["name"] for c in inspector.get_columns("users")}
    if "campus" not in columns:
        db.session.execute(text("ALTER TABLE users ADD COLUMN campus VARCHAR(20)"))
        db.session.commit()
        print("已为 users 表补充 campus 列")


with app.app_context():
    initialize_database()
    _ensure_users_campus_column()
    print("开始同步测试账号...")
    for cfg in TEST_USERS:
        user = User.query.filter_by(email=cfg["email"]).first()
        if not user:
            user = User.query.filter_by(username=cfg["username"]).first()

        if user:
            action = "已更新"
        else:
            user = User()
            db.session.add(user)
            action = "已创建"

        user.email = cfg["email"]
        user.username = cfg["username"]
        user.password_hash = generate_password_hash(cfg["password"])
        user.email_verified = True
        user.email_verified_at = datetime.now(timezone.utc)

        db.session.flush()
        print(f"{action}测试账号:")
        print(f"  用户名: {user.username}")
        print(f"  邮箱: {user.email}")
        print(f"  密码: {cfg['password']}")
        print(f"  email_verified: {user.email_verified}")
        print(f"  id: {user.id}")
        print("-" * 36)

    db.session.commit()
    print("测试账号同步完成。")
