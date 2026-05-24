# app/services/amap.py
import requests
from flask import current_app

# 高德地图 Web API 的基础地址（就像外卖平台的主页）
BASE_URL = "https://restapi.amap.com/v3"

def _get_key():
    """从 Flask 应用配置里取出 API Key"""
    # current_app 是 Flask 提供的一个特殊对象，代表当前正在运行的应用
    return current_app.config['GAODE_API_KEY']

def amap_request(endpoint, params):
    """
    向高德 API 发送请求的通用函数
    :param endpoint: API 具体路径，比如 '/place/text'
    :param params:  查询参数字典，比如 {'keywords': '川菜', 'city': '南京'}
    :return:        高德返回的 JSON 数据（字典格式）
    """
    # 所有请求都要带上 key（通行证）
    params['key'] = _get_key()
    
    # 拼接完整 URL
    url = f"{BASE_URL}{endpoint}"
    
    # 发送 GET 请求（就像在浏览器地址栏输入网址并回车）
    response = requests.get(url, params=params)
    
    # 把高德返回的 JSON 字符串转换成 Python 字典（方便后续处理）
    # raise_for_status() 会在请求失败时（比如网络断掉）抛出异常
    response.raise_for_status()
    return response.json()

# 下面封装三个最常用的功能：

def search_places(keywords, city=None, location=None, page=1):
    """
    POI 搜索（搜索兴趣点，如餐厅、景点）
    :param keywords: 搜索关键词，如 "川菜"、"火锅"
    :param city:     城市名，如 "南京"，可选（若不提供，可用 location 周边搜索）
    :param location: 中心点坐标，如 "116.397428,39.90923"（经度,纬度）
    :param page:     页码
    :return:         搜索结果列表
    """
    params = {
        'keywords': keywords,
        'offset': 20,   # 每页条数
        'page': page,
        'extensions': 'all'  # 返回详细信息
    }
    # 优先用城市搜索；如果没给城市但给了坐标，就用周边搜索
    if city:
        params['city'] = city
        endpoint = '/place/text'      # 文本关键字搜索
    elif location:
        params['location'] = location
        endpoint = '/place/around'    # 周边搜索
    else:
        raise ValueError("必须提供 city 或 location 参数之一")
    
    return amap_request(endpoint, params)

def geocode(address, city=None):
    """
    地理编码：把地址文字转换成经纬度坐标
    :param address: 地址字符串，如 "南京市鼓楼区汉口路22号"
    :param city:    城市，可选，用于限定范围
    :return:        坐标信息
    """
    params = {'address': address}
    if city:
        params['city'] = city
    return amap_request('/geocode/geo', params)

def regeocode(location):
    """
    逆地理编码：把经纬度坐标转换成地址描述
    :param location: "经度,纬度" 字符串
    :return:        地址信息
    """
    params = {'location': location, 'extensions': 'all'}
    return amap_request('/geocode/regeo', params)