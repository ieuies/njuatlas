# app/services/amap.py
from copy import deepcopy
from threading import Lock
import time

import requests
from flask import current_app
from app.logging_utils import log_event

# 高德地图 Web API 的基础地址（就像外卖平台的主页）
BASE_URL = "https://restapi.amap.com/v3"
_CACHE = {}
_CACHE_LOCK = Lock()


def _normalize_cache_value(value):
    """把缓存键中的值统一成稳定字符串。"""
    if value is None:
        return ""
    return str(value).strip().lower()


def _make_cache_key(endpoint, params):
    """根据接口路径和参数生成缓存键。

    key 本身不进入缓存键，避免密钥出现在调试输出或内存转储里。
    """
    return (
        endpoint,
        tuple(
            sorted(
                (name, _normalize_cache_value(value))
                for name, value in params.items()
                if name != "key"
            )
        ),
    )


def _get_cached(cache_key):
    """读取未过期的缓存结果。"""
    ttl = current_app.config["AMAP_CACHE_TTL_SECONDS"]
    if ttl <= 0:
        return None

    now = time.time()
    with _CACHE_LOCK:
        cached = _CACHE.get(cache_key)
        if not cached:
            return None

        expires_at, data = cached
        if expires_at <= now:
            _CACHE.pop(cache_key, None)
            return None

        return deepcopy(data)


def _set_cached(cache_key, data):
    """写入缓存，并限制缓存条目数量。"""
    ttl = current_app.config["AMAP_CACHE_TTL_SECONDS"]
    max_items = current_app.config["AMAP_CACHE_MAX_ITEMS"]
    if ttl <= 0 or max_items <= 0:
        return

    expires_at = time.time() + ttl
    with _CACHE_LOCK:
        if len(_CACHE) >= max_items:
            oldest_key = min(_CACHE, key=lambda key: _CACHE[key][0])
            _CACHE.pop(oldest_key, None)
        _CACHE[cache_key] = (expires_at, deepcopy(data))

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
    params = dict(params)
    cache_key = _make_cache_key(endpoint, params)
    cached = _get_cached(cache_key)
    if cached is not None:
        cached["_cache"] = {"hit": True}
        log_event(current_app.logger, "amap_cache_hit", endpoint=endpoint)
        return cached

    # 所有请求都要带上 key（通行证）
    params['key'] = _get_key()
    
    # 拼接完整 URL
    url = f"{BASE_URL}{endpoint}"
    
    # 发送 GET 请求（就像在浏览器地址栏输入网址并回车）
    try:
        response = requests.get(
            url,
            params=params,
            timeout=current_app.config["AMAP_REQUEST_TIMEOUT_SECONDS"],
        )
    except requests.RequestException as exc:
        log_event(current_app.logger, "amap_request_failed", level="warning", endpoint=endpoint, error=str(exc))
        raise
    
    # 把高德返回的 JSON 字符串转换成 Python 字典（方便后续处理）
    # raise_for_status() 会在请求失败时（比如网络断掉）抛出异常
    response.raise_for_status()
    data = response.json()
    _set_cached(cache_key, data)
    data["_cache"] = {"hit": False}
    log_event(
        current_app.logger,
        "amap_request_succeeded",
        endpoint=endpoint,
        status=data.get("status"),
        count=data.get("count"),
    )
    return data

# 下面封装三个最常用的功能：

def search_places(keywords, city=None, location=None, page=1, page_size=20):
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
        'offset': page_size,   # 每页条数
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
