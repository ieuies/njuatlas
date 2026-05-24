# app/routes/llm_routes.py
from flask import Blueprint, request, jsonify
from app.models import Restaurant, Review
from app.services.llm import chat_with_llm

llm_bp = Blueprint('llm', __name__, url_prefix='/api/llm')

@llm_bp.route('/recommend_slogan', methods=['GET'])
def recommend_slogan():
    """
    为指定餐厅生成一句推荐语。
    请求参数：restaurant_id（必填）
    """
    restaurant_id = request.args.get('restaurant_id', type=int)
    if not restaurant_id:
        return jsonify({'error': '缺少 restaurant_id 参数'}), 400
    
    # 查数据库
    restaurant = Restaurant.query.get(restaurant_id)
    if not restaurant:
        return jsonify({'error': '餐厅不存在'}), 404
    
    # 收集已有评论的前三条，作为 AI 的参考信息
    reviews = Review.query.filter_by(restaurant_id=restaurant_id).limit(3).all()
    reviews_text = ""
    if reviews:
        reviews_text = "已有食客评价：" + "；".join([r.content for r in reviews])
    
    # 构造消息列表（System Prompt 就是在这里发挥魔法）
    messages = [
        {
            "role": "system",
            "content": (
                "你是一个资深美食评论家，说话风格俏皮、接地气、吸引年轻人。"
                "请根据餐厅信息和已有评价，生成一句不超过 40 字的推荐语。"
                "不要使用'这家店'、'它'等代词，要直接、有感染力。"
            )
        },
        {
            "role": "user",
            "content": f"餐厅名称：{restaurant.name}\n地址：{restaurant.address or '未知'}\n{reviews_text}\n\n请为这家餐厅写一句推荐语。"
        }
    ]
    
    try:
        slogan = chat_with_llm(messages, temperature=0.9, max_tokens=100)
        return jsonify({'restaurant_id': restaurant_id, 'slogan': slogan})
    except Exception as e:
        return jsonify({'error': f'AI 生成失败: {str(e)}'}), 500
    

from app.models import Like, Favorite
from app.services.amap import search_places

@llm_bp.route('/chat_recommend', methods=['POST'])
def chat_recommend():
    """
    多轮对话推荐接口。
    前端传 JSON：
      - user_id（必填）：当前用户 ID
      - message（必填）：用户说的话，如"想吃火锅，离仙林近的"
      - history（可选）：之前的对话历史列表
      - city（可选）：城市，默认"南京"
    """
    data = request.get_json()
    if not data or 'user_id' not in data or 'message' not in data:
        return jsonify({'error': '缺少 user_id 或 message'}), 400
    
    user_id = data['user_id']
    user_message = data['message']
    history = data.get('history', [])  # 前端传来的历史对话，格式同 messages
    city = data.get('city', '南京')
    
    # ==========================================
    # 第一步：收集用户偏好（从点赞和收藏中分析）
    # ==========================================
    # 获取用户点赞过的餐厅（取最多 10 条）
    liked = Like.query.filter_by(user_id=user_id).limit(10).all()
    favorited = Favorite.query.filter_by(user_id=user_id).limit(10).all()
    
    liked_names = []
    # 用集合（set）去重，避免同一个餐厅既点赞又收藏被算两次
    restaurant_names = set()
    for l in liked:
        restaurant_names.add(l.restaurant.name)
    for f in favorited:
        restaurant_names.add(f.restaurant.name)
    
    preference_text = ""
    if restaurant_names:
        preference_text = "这位用户喜欢的餐厅有：" + "、".join(list(restaurant_names)[:5]) + "。"
    
    # ==========================================
    # 第二步：用高德 API 搜索相关餐厅
    # ==========================================
    search_result = search_places(user_message, city=city)
    candidates = []
    if search_result.get('status') == '1':
        pois = search_result.get('pois', [])  # pois = POI 列表（Points of Interest）
        for poi in pois[:5]:  # 最多取前 5 家候选
            candidates.append({
                'name': poi.get('name', '未知'),
                'address': poi.get('address', '未知'),
                'location': poi.get('location', ''),
                'rating': poi.get('biz_ext', {}).get('rating', '暂无评分'),
                'cost': poi.get('biz_ext', {}).get('cost', '暂无价格')
            })
    
    if not candidates:
        candidates_text = "（未找到匹配的餐厅，请推荐几家南京的知名餐厅）"
    else:
        candidates_text = "以下是搜索到的真实餐厅：\n"
        for i, c in enumerate(candidates, 1):
            candidates_text += f"{i}. {c['name']} - {c['address']} - 评分{c['rating']} - 人均{c['cost']}\n"
    
    # ==========================================
    # 第三步：构造 System Prompt + 多轮对话
    # ==========================================
    system_prompt = (
        "你是一个友好的美食推荐助手，专门帮南京的大学生推荐附近好吃的餐厅。\n"
        "规则：\n"
        "1. 推荐时必须基于真实存在的餐厅信息，不要编造。\n"
        "2. 回答要生动、热情，有'种草'的感觉。\n"
        "3. 每次推荐 2~3 家，说明推荐理由。\n"
        "4. 要考虑到用户的口味偏好。\n"
        f"{preference_text}"
    )
    
    # 构建完整的消息列表：系统设定 + 历史对话 + 当前用户问题
    messages = [{"role": "system", "content": system_prompt}]
    
    # 把历史对话追加上去（前端要负责保存和传回）
    for h in history:
        messages.append(h)
    
    # 当前这一轮：用户的问题 + 搜索结果
    messages.append({
        "role": "user",
        "content": f"{user_message}\n\n{candidates_text}"
    })
    
    try:
        reply = chat_with_llm(messages, temperature=0.8, max_tokens=600)
        return jsonify({
            'reply': reply,
            'candidates': candidates  # 前端可以用这个数据在地图上打标记
        })
    except Exception as e:
        return jsonify({'error': f'AI 回复失败: {str(e)}'}), 500