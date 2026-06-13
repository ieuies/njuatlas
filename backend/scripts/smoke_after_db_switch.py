"""Smoke checks after Neon database switch."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import inspect, text

from app import create_app, db


def _get(url: str, timeout: int = 20) -> tuple[int, dict | list | str]:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(body)
            except json.JSONDecodeError:
                return resp.status, body
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(body)
        except json.JSONDecodeError:
            return exc.code, body


def check_new_database() -> list[str]:
    issues: list[str] = []
    app = create_app()
    with app.app_context():
        tables = inspect(db.engine).get_table_names()
        if len(tables) < 20:
            issues.append(f"expected >=20 tables, got {len(tables)}")
        version = db.session.execute(text("SELECT version_num FROM alembic_version")).scalar()
        if version != "r9s5t1u7v019":
            issues.append(f"unexpected alembic head: {version}")
        for table in ("users", "places", "event_posts"):
            count = db.session.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
            if count != 0:
                issues.append(f"{table} should be empty, got {count}")
    return issues


def check_production(api_base: str = "https://api.njuatlas.cn") -> list[str]:
    issues: list[str] = []
    status, health = _get(f"{api_base}/api/health")
    if status != 200 or not isinstance(health, dict) or health.get("status") != "ok":
        issues.append(f"/api/health failed: {status} {health}")

    status, posts = _get(f"{api_base}/api/posts?page=1&page_size=1")
    if status != 200 or not isinstance(posts, dict):
        issues.append(f"/api/posts failed: {status} {posts}")
    elif posts.get("items"):
        issues.append(
            "production still returns posts — Render DATABASE_URL may still point at old Neon"
        )

    status, guide = _get(f"{api_base}/api/places/guide-bundle?campus=%E9%BC%93%E6%A5%BC")
    if status != 200 or not isinstance(guide, dict):
        issues.append(f"/api/places/guide-bundle failed: {status} {guide}")

    return issues


def main() -> int:
    db_issues = check_new_database()
    prod_issues = check_production()

    print("=== New DATABASE_URL (local env) ===")
    if db_issues:
        for item in db_issues:
            print("FAIL:", item)
    else:
        print("OK: schema at head, core tables empty")

    print("\n=== Production API ===")
    if prod_issues:
        for item in prod_issues:
            print("WARN:", item)
    else:
        print("OK: health, empty posts, guide reachable")

    return 1 if db_issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
