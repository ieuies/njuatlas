# app/routes/interactions.py
from flask import Blueprint, request, jsonify
from app.models import User, Restaurant, Review, Like, Favorite
from app import db

inter_bp = Blueprint('interactions', __name__, url_prefix='/api')

@inter_bp.route('/restaurant', methods=['POST'])
def add_restaurant():
    """添加一个餐厅（前端传 JSON：name, address, location, poi_id, user_id）"""
    data = request.get_json()
    required = ['name', 'user_id']
    if not data or not all(k in data for k in required):
        return jsonify({'error': '缺少必要参数 name 或 user_id'}), 400
    
    # 检查用户是否存在
    user = User.query.get(data['user_id'])
    if not user:
        return jsonify({'error': '用户不存在'}), 404
    
    # 如果提供了高德POI ID，先检查是否已存在（防止重复添加）
    poi_id = data.get('poi_id')
    if poi_id:
        existing = Restaurant.query.filter_by(poi_id=poi_id).first()
        if existing:
            return jsonify({'id': existing.id, 'name': existing.name, 'message': '餐厅已存在'}), 200
    
    restaurant = Restaurant(
        name=data['name'],
        address=data.get('address', ''),
        location=data.get('location', ''),
        poi_id=poi_id,
        added_by=data['user_id']
    )
    db.session.add(restaurant)
    db.session.commit()
    return jsonify({'id': restaurant.id, 'name': restaurant.name}), 201

@inter_bp.route('/review', methods=['POST'])
def add_review():
    """写短评（需 user_id, restaurant_id, content，可选 rating）"""
    data = request.get_json()
    required = ['user_id', 'restaurant_id', 'content']
    if not data or not all(k in data for k in required):
        return jsonify({'error': '缺少 user_id, restaurant_id 或 content'}), 400
    
    user = User.query.get(data['user_id'])
    restaurant = Restaurant.query.get(data['restaurant_id'])
    if not user or not restaurant:
        return jsonify({'error': '用户或餐厅不存在'}), 404
    
    review = Review(
        content=data['content'],
        rating=data.get('rating'),  # 可选
        user_id=data['user_id'],
        restaurant_id=data['restaurant_id']
    )
    db.session.add(review)
    db.session.commit()
    return jsonify({'id': review.id, 'content': review.content}), 201

@inter_bp.route('/like', methods=['POST'])
def toggle_like():
    """点赞（如已点赞则取消，前端只需传 user_id 和 restaurant_id）"""
    data = request.get_json()
    if not data or 'user_id' not in data or 'restaurant_id' not in data:
        return jsonify({'error': '需要 user_id 和 restaurant_id'}), 400
    
    # 查找是否已存在点赞记录
    existing = Like.query.filter_by(
        user_id=data['user_id'], 
        restaurant_id=data['restaurant_id']
    ).first()
    
    if existing:
        db.session.delete(existing)
        db.session.commit()
        return jsonify({'liked': False, 'message': '已取消点赞'})
    else:
        like = Like(user_id=data['user_id'], restaurant_id=data['restaurant_id'])
        db.session.add(like)
        db.session.commit()
        return jsonify({'liked': True, 'message': '点赞成功'})

@inter_bp.route('/favorite', methods=['POST'])
def toggle_favorite():
    """收藏（逻辑同点赞）"""
    data = request.get_json()
    if not data or 'user_id' not in data or 'restaurant_id' not in data:
        return jsonify({'error': '需要 user_id 和 restaurant_id'}), 400
    
    existing = Favorite.query.filter_by(
        user_id=data['user_id'], 
        restaurant_id=data['restaurant_id']
    ).first()
    
    if existing:
        db.session.delete(existing)
        db.session.commit()
        return jsonify({'favorited': False, 'message': '已取消收藏'})
    else:
        fav = Favorite(user_id=data['user_id'], restaurant_id=data['restaurant_id'])
        db.session.add(fav)
        db.session.commit()
        return jsonify({'favorited': True, 'message': '收藏成功'})

# 获取某个餐厅的点赞数和收藏数（前端展示用）
@inter_bp.route('/restaurant/<int:restaurant_id>/stats', methods=['GET'])
def restaurant_stats(restaurant_id):
    """获取餐厅统计数据"""
    restaurant = Restaurant.query.get(restaurant_id)
    if not restaurant:
        return jsonify({'error': '餐厅不存在'}), 404
    
    likes_count = Like.query.filter_by(restaurant_id=restaurant_id).count()
    favs_count = Favorite.query.filter_by(restaurant_id=restaurant_id).count()
    reviews = Review.query.filter_by(restaurant_id=restaurant_id).order_by(Review.created_at.desc()).all()
    
    return jsonify({
        'restaurant_id': restaurant_id,
        'likes': likes_count,
        'favorites': favs_count,
        'reviews': [{'id': r.id, 'content': r.content, 'rating': r.rating, 'user_id': r.user_id, 'created_at': r.created_at} for r in reviews]
    })