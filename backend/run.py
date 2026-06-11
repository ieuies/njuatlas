import sys

from app import create_app
from app.db_utils import initialize_database


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

app = create_app()


if __name__ == "__main__":
    with app.app_context():
        # Local convenience only. Production should run `flask db upgrade`
        # before Gunicorn so schema changes are explicit and repeatable.
        initialize_database()
        print("Database tables are ready.")
    app.run(debug=True, host="0.0.0.0", port=5000)
