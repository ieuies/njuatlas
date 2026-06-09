"""本地测试用：创建一个已验证邮箱的账号，便于直接登录。

仅用于本地开发，请勿在生产环境运行。
用法：在 backend 目录下执行  python seed_test_user.py
"""
from datetime import datetime, timezone

from sqlalchemy import inspect, text
from werkzeug.security import generate_password_hash

from app import create_app, db
from app.db_utils import initialize_database
from app.models import User

TEST_EMAIL = "test@njuatlas.local"
TEST_PASSWORD = "test1234"
TEST_USERNAME = "测试用户"

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
    user = User.query.filter_by(email=TEST_EMAIL).first()
    if user:
        user.password_hash = generate_password_hash(TEST_PASSWORD)
        user.email_verified = True
        user.email_verified_at = datetime.now(timezone.utc)
        action = "已更新"
    else:
        user = User(
            email=TEST_EMAIL,
            username=TEST_USERNAME,
            password_hash=generate_password_hash(TEST_PASSWORD),
            email_verified=True,
            email_verified_at=datetime.now(timezone.utc),
        )
        db.session.add(user)
        action = "已创建"
    db.session.commit()
    print(f"{action}测试账号:")
    print(f"  邮箱: {TEST_EMAIL}")
    print(f"  密码: {TEST_PASSWORD}")
    print(f"  用户名: {user.username}")
    print(f"  email_verified: {user.email_verified}")
