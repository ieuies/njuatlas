# app/models.py
from app import db
from datetime import datetime

class User(db.Model):
    """用户表"""
    __tablename__ = 'users'          # 表名（如果不写，默认用类名小写）
    
    id = db.Column(db.Integer, primary_key=True)                     # 主键：唯一编号，自动递增
    username = db.Column(db.String(50), unique=True, nullable=False) # 用户名，唯一且不能为空
    password = db.Column(db.String(100), nullable=False)             # 密码（⚠️ 明文存储，仅开发阶段！）
    created_at = db.Column(db.DateTime, default=datetime.utcnow)     # 注册时间
    
    # 与评论、点赞、收藏的关系（ORM 可以自动通过关联查询到对应的数据）
    reviews = db.relationship('Review', backref='user', lazy=True)
    likes = db.relationship('Like', backref='user', lazy=True)
    favorites = db.relationship('Favorite', backref='user', lazy=True)

class Restaurant(db.Model):
    """餐厅表"""
    __tablename__ = 'restaurants'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)           # 餐厅名称
    address = db.Column(db.String(200))                        # 地址
    location = db.Column(db.String(50))                        # 经纬度 "lng,lat"
    poi_id = db.Column(db.String(100))                         # 高德POI的唯一ID（方便去重）
    added_by = db.Column(db.Integer, db.ForeignKey('users.id'))# 谁添加的
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    reviews = db.relationship('Review', backref='restaurant', lazy=True)
    likes = db.relationship('Like', backref='restaurant', lazy=True)
    favorites = db.relationship('Favorite', backref='restaurant', lazy=True)

class Review(db.Model):
    """短评表"""
    __tablename__ = 'reviews'
    
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.String(500), nullable=False)         # 评论内容
    rating = db.Column(db.Integer)                              # 评分（1~5星）
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    restaurant_id = db.Column(db.Integer, db.ForeignKey('restaurants.id'))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Like(db.Model):
    """点赞表（记录哪个用户点了哪个餐厅的赞）"""
    __tablename__ = 'likes'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    restaurant_id = db.Column(db.Integer, db.ForeignKey('restaurants.id'))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # 保证同一个用户对同一个餐厅只能有一条点赞记录
    __table_args__ = (db.UniqueConstraint('user_id', 'restaurant_id', name='_user_restaurant_like_uc'),)

class Favorite(db.Model):
    """收藏表（功能同点赞，但概念不同，所以单建表）"""
    __tablename__ = 'favorites'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    restaurant_id = db.Column(db.Integer, db.ForeignKey('restaurants.id'))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    __table_args__ = (db.UniqueConstraint('user_id', 'restaurant_id', name='_user_restaurant_fav_uc'),)