import os

from dotenv import load_dotenv
from flask import Flask, jsonify
from flask_cors import CORS
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy


load_dotenv()

from app.config import Config, validate_config
from app.logging_utils import configure_logging


db = SQLAlchemy()
migrate = Migrate()


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    configure_logging(app)

    if not app.config.get("SQLALCHEMY_DATABASE_URI"):
        basedir = os.path.abspath(os.path.dirname(__file__))
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + os.path.join(basedir, "..", "foodmap.db")

    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
        "pool_recycle": 300,
    }

    validate_config(app)

    db.init_app(app)
    migrate.init_app(app, db)

    from app.errors import register_error_handlers
    from app.rate_limit import init_rate_limiter
    from app.routes.auth import auth_bp
    from app.routes.interactions import inter_bp
    from app.routes.llm_routes import llm_bp
    from app.routes.note_routes import note_bp
    from app.routes.places import places_bp
    from app.routes.profile import profile_bp
    from app.routes.social import social_bp

    app.register_blueprint(places_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(inter_bp)
    app.register_blueprint(llm_bp)
    app.register_blueprint(note_bp)
    app.register_blueprint(profile_bp)
    app.register_blueprint(social_bp)
    register_error_handlers(app)
    init_rate_limiter(app)

    CORS(app, resources={r"/api/*": {"origins": "*"}})

    @app.route("/")
    def index():
        return jsonify({
            "status": "ok",
            "service": "njuatlas-backend",
            "message": "NjuAtlas backend is running. Use /health or /api/* endpoints.",
        })

    @app.route("/health")
    def health():
        return jsonify({
            "status": "ok",
            "service": "njuatlas-backend",
            "dm_api": "tail-v2",
        })

    return app
