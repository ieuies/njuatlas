# app/routes/auth.py
from flask import Blueprint, request, jsonify
from app.models import User
from app import db

auth_bp = Blueprint('auth', __name__, url_prefix='/api/user')

@auth_bp.route('/register', methods=['POST'])
def register():
    """用户注册（接收 JSON 中的 username 和 password）"""
    data = request.get_json()   # 从请求体里取出 JSON 数据
    if not data or not data.get('username') or not data.get('password'):
        return jsonify({'error': '需要 username 和 password'}), 400
    
    # 检查用户名是否已存在
    if User.query.filter_by(username=data['username']).first():
        return jsonify({'error': '用户名已被注册'}), 409  # 409 冲突
    
    # 创建新用户
    new_user = User(username=data['username'], password=data['password'])
    db.session.add(new_user)
    db.session.commit()
    
    return jsonify({'id': new_user.id, 'username': new_user.username}), 201

@auth_bp.route('/login', methods=['POST'])
def login():
    """用户登录（比对明文密码）"""
    data = request.get_json()
    user = User.query.filter_by(username=data.get('username')).first()
    if user and user.password == data.get('password'):
        return jsonify({'id': user.id, 'username': user.username})
    return jsonify({'error': '用户名或密码错误'}), 401