from copy import deepcopy
from threading import Lock
import time

import requests
from flask import current_app

from app.logging_utils import log_event


BASE_URL = "https://restapi.amap.com/v3"
_CACHE = {}
_CACHE_LOCK = Lock()


def _normalize_cache_value(value):
    if value is None:
        return ""
    return str(value).strip().lower()


def _make_cache_key(endpoint, params):
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
    return current_app.config["GAODE_API_KEY"]


def amap_request(endpoint, params):
    params = dict(params)
    cache_key = _make_cache_key(endpoint, params)
    cached = _get_cached(cache_key)
    if cached is not None:
        cached["_cache"] = {"hit": True}
        log_event(current_app.logger, "amap_cache_hit", endpoint=endpoint)
        return cached

    params["key"] = _get_key()
    url = f"{BASE_URL}{endpoint}"

    try:
        response = requests.get(
            url,
            params=params,
            timeout=current_app.config["AMAP_REQUEST_TIMEOUT_SECONDS"],
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        log_event(current_app.logger, "amap_request_failed", level="warning", endpoint=endpoint, error=str(exc))
        raise

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


def search_places(keywords, city=None, location=None, page=1, page_size=20, radius=5000, types=None):
    params = {
        "keywords": keywords,
        "offset": page_size,
        "page": page,
        "extensions": "all",
    }

    if types:
        params["types"] = types

    if location:
        params["location"] = location
        params["radius"] = radius
        endpoint = "/place/around"
    elif city:
        params["city"] = city
        endpoint = "/place/text"
    else:
        raise ValueError("city or location is required")

    return amap_request(endpoint, params)


def geocode(address, city=None):
    params = {"address": address}
    if city:
        params["city"] = city
    return amap_request("/geocode/geo", params)


def regeocode(location):
    return amap_request("/geocode/regeo", {"location": location, "extensions": "all"})
