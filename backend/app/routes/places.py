# app/routes/places.py
from flask import Blueprint, request, jsonify, current_app
from app.services.amap import search_places

# 创建一个名为 'places' 的蓝图（蓝图就是一个“子模块”，可以独立管理路由）
places_bp = Blueprint('places', __name__, url_prefix='/api/places')

# 预存一些热门商圈的中心坐标（方便前端展示默认区域）
HOT_AREAS = {
    'xinjiekou': {'name': '新街口', 'location': '118.78472,32.03517'},
    'fuzimiao':  {'name': '夫子庙',   'location': '118.78811,32.02056'},
    'xianlin':   {'name': '仙林大学城', 'location': '118.93021,32.10247'},
    'jiangning': {'name': '江宁大学城', 'location': '118.88359,31.93439'},
}

@places_bp.route('/hot_areas', methods=['GET'])
def get_hot_areas():
    """返回热门商圈列表"""
    return jsonify(HOT_AREAS)

@places_bp.route('/search', methods=['GET'])
def search():
    """
    搜索餐厅或地点
    请求参数（前端通过 ?key=value 的方式传过来）：
        keyword: 必填，搜索关键词
        city:    可选，城市名（如“南京”）
        location:可选，经纬度（如“118.78472,32.03517”）
        page:    可选，页码，默认为1
    """
    # request.args 是一个字典，包含了 URL 里的所有查询参数
    keyword = request.args.get('keyword')
    if not keyword:
        return jsonify({'error': 'keyword 参数是必填的'}), 400  # 400 状态码表示“客户端请求错误”
    
    city = request.args.get('city', '南京')  # 如果不传，默认搜南京
    location = request.args.get('location')
    page = request.args.get('page', 1, type=int)  # type=int 会自动转成整数
    
    # 调用我们封装好的高德搜索函数
    result = search_places(keyword, city=city, location=location, page=page)
    
    # 检查高德返回的状态
    if result.get('status') != '1':
        return jsonify({'error': '高德API调用失败', 'detail': result}), 500  # 500 表示服务器内部错误
    
    # 返回给前端
    return jsonify(result)