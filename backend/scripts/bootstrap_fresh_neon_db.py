"""One-off bootstrap for a fresh Neon PostgreSQL database.

Production migrations assume base tables already exist (historically from
db.create_all in local dev). On an empty Neon database, run this once with a
**direct** connection URL (host without ``-pooler``), then deploy normally.

Usage (PowerShell):

    cd backend
    $env:FLASK_APP = "app:create_app"
    $env:DATABASE_URL = "postgresql://...direct-host.../neondb?sslmode=require"
    python scripts/bootstrap_fresh_neon_db.py
    flask db stamp head

After bootstrap, point Render ``DATABASE_URL`` at the **pooler** URL.
"""

from __future__ import annotations

import os
import sys

# Allow running as: python scripts/bootstrap_fresh_neon_db.py
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app, db
from sqlalchemy import inspect, text


def main() -> int:
    app = create_app()
    with app.app_context():
        db.create_all()
        tables = inspect(db.engine).get_table_names()
        print(f"create_all ok ({len(tables)} tables)")

        if "alembic_version" in tables:
            version = db.session.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar()
            print(f"alembic_version: {version or '(empty — run flask db stamp head)'}")
        else:
            print("alembic_version table missing — run: flask db stamp head")

        for table in ("users", "places", "event_posts"):
            if table in tables:
                count = db.session.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
                print(f"{table}: {count}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
