"""在线上数据库创建/更新测试账号（用户名 test）。

读取 backend/.env 中的 DATABASE_URL，请确认指向目标库后再运行：

    cd backend
    python scripts/seed_online_test_user.py

可选参数：
    python scripts/seed_online_test_user.py --email test@example.com --password test1234
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from werkzeug.security import generate_password_hash

from app import create_app, db
from app.models import User

DEFAULT_EMAIL = "test@njuatlas.local"
DEFAULT_PASSWORD = "test1234"
DEFAULT_USERNAME = "test"


def parse_args():
    parser = argparse.ArgumentParser(description="Create or update the online test user.")
    parser.add_argument("--username", default=DEFAULT_USERNAME)
    parser.add_argument("--email", default=DEFAULT_EMAIL)
    parser.add_argument("--password", default=DEFAULT_PASSWORD)
    return parser.parse_args()


def main():
    args = parse_args()
    app = create_app()

    with app.app_context():
        db_uri = app.config.get("SQLALCHEMY_DATABASE_URI") or ""
        if not db_uri:
            print("错误：未配置 DATABASE_URL。")
            sys.exit(1)

        host_hint = db_uri.split("@")[-1].split("/")[0] if "@" in db_uri else db_uri[:40]
        print(f"目标数据库: ...@{host_hint}")

        user = User.query.filter_by(username=args.username).first()
        if not user:
            existing_email = User.query.filter_by(email=args.email.lower()).first()
            if existing_email:
                print(f"错误：邮箱 {args.email} 已被用户 id={existing_email.id} 占用。")
                sys.exit(1)
            user = User()
            db.session.add(user)
            action = "已创建"
        else:
            action = "已更新"

        user.email = args.email.strip().lower()
        user.username = args.username
        user.password_hash = generate_password_hash(args.password)
        user.email_verified = True
        user.email_verified_at = datetime.now(timezone.utc)
        user.bubble_style = user.bubble_style or "atlas-classic"

        db.session.commit()

        print(action)
        print(f"  id: {user.id}")
        print(f"  用户名: {user.username}")
        print(f"  邮箱: {user.email}")
        print(f"  密码: {args.password}")
        print(f"  email_verified: {user.email_verified}")


if __name__ == "__main__":
    main()
