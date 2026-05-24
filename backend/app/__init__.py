# app/__init__.py
from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from dotenv import load_dotenv
from flask_cors import CORS
import os

# 加载 .env 文件
load_dotenv()

# ⚠️ 关键修改：将 db 的定义提到最前面，避免循环导入
db = SQLAlchemy()

def create_app():
    app = Flask(__name__)
    app.config['GAODE_API_KEY'] = os.getenv('GAODE_API_KEY', '')

    # 数据库配置
    basedir = os.path.abspath(os.path.dirname(__file__))
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, '..', 'foodmap.db')
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

    # 将 db 与当前 app 绑定
    db.init_app(app)

    # 延迟导入蓝图：放在 db.init_app 之后，避免循环依赖
    from app.routes.places import places_bp
    from app.routes.auth import auth_bp
    from app.routes.interactions import inter_bp
    from app.routes.llm_routes import llm_bp

    app.register_blueprint(places_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(inter_bp)
    app.register_blueprint(llm_bp)

    CORS(app, resources={r"/api/*": {"origins": "*"}})

    return app