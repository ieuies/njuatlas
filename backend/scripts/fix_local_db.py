"""Fix broken local SQLite alembic version and apply pending migrations."""
import sqlite3
import subprocess
import sys
from pathlib import Path

DB = Path(__file__).resolve().parents[1] / "foodmap.db"
STAMP = "c4e8a1f2b903"


def main():
    if not DB.exists():
        print(f"No database at {DB}")
        return 1

    conn = sqlite3.connect(DB)
    row = conn.execute("SELECT version_num FROM alembic_version").fetchone()
    print(f"Current alembic version: {row[0] if row else 'none'}")

    conn.execute("UPDATE alembic_version SET version_num = ?", (STAMP,))
    conn.commit()
    conn.close()
    print(f"Stamped alembic_version -> {STAMP}")

    backend = DB.parent
    result = subprocess.run(
        [sys.executable, "-m", "flask", "db", "upgrade"],
        cwd=backend,
        capture_output=True,
        text=True,
    )
    print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    if result.returncode != 0:
        return result.returncode

    conn = sqlite3.connect(DB)
    cols = [r[1] for r in conn.execute("PRAGMA table_info(places)")]
    ver = conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
    conn.close()
    print(f"After upgrade: alembic={ver}")
    print(f"places columns: {cols}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
