import { API_BASE, IS_CROSS_ORIGIN_API } from './config.js';
import { showToast } from './utils.js';

let authToken = localStorage.getItem('access_token') || null;
const DEFAULT_TIMEOUT_MS = 12000;
const LOGIN_TIMEOUT_MS = 10000;

function _emitAuthChange() {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('njuatlas:auth-change'));
    }
}

function _clearAuthSession() {
    authToken = null;
    localStorage.removeItem('access_token');
    localStorage.removeItem('current_user');
    if (typeof window.clearNavUnreadBadges === 'function') window.clearNavUnreadBadges();
    if (typeof window.clearMessagesTabBadges === 'function') window.clearMessagesTabBadges();
    _emitAuthChange();
}

export function setAuthToken(token) {
    authToken = token;
    if (token) localStorage.setItem('access_token', token);
    else localStorage.removeItem('access_token');
}

export function getAuthToken() {
    return authToken;
}

async function request(endpoint, method = 'GET', body = null, needAuth = true, timeoutMs = DEFAULT_TIMEOUT_MS, silent = false, fetchSignal = null) {
    const url = `${API_BASE}${endpoint}`;
    const headers = {};
    if (body != null) headers['Content-Type'] = 'application/json';
    if (needAuth && authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (fetchSignal) {
        if (fetchSignal.aborted) controller.abort();
        else fetchSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
    const options = { method, headers, signal: controller.signal };
    if (body) options.body = JSON.stringify(body);
    try {
        const res = await fetch(url, options);
        clearTimeout(timeoutId);
        let data;
        try {
            data = await res.json();
        } catch (jsonErr) {
            const text = await res.text();
            console.error('API非JSON响应:', res.status, text);
            throw new Error(`服务器返回异常 (${res.status})`);
        }
        if (!res.ok) {
            if (res.status === 401 && needAuth) {
                _clearAuthSession();
                throw new Error('UNAUTHORIZED');
            }
            throw new Error(data.message || `请求失败: ${res.status}`);
        }
        return data;
    } catch (err) {
        clearTimeout(timeoutId);
        if (fetchSignal) fetchSignal.removeEventListener('abort', onExternalAbort);
        if (err.name === 'AbortError') {
            if (fetchSignal?.aborted) throw err;
            err = new Error('请求超时，请稍后重试');
        }
        if (err.message === 'UNAUTHORIZED') throw err;
        console.error('API请求错误:', err);
        if (!silent) showToast(err.message || '网络错误，请检查后端是否启动');
        throw err;
    }
}

/** 公开接口；仅在同域时附带 token，避免跨域 GET 触发 CORS 预检失败 */
async function requestOptionalAuth(endpoint, method = 'GET', body = null, timeoutMs = DEFAULT_TIMEOUT_MS, silent = false) {
    const url = `${API_BASE}${endpoint}`;
    const headers = {};
    if (body != null) headers['Content-Type'] = 'application/json';
    if (authToken && !IS_CROSS_ORIGIN_API) headers['Authorization'] = `Bearer ${authToken}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const options = { method, headers, signal: controller.signal };
    if (body) options.body = JSON.stringify(body);
    try {
        const res = await fetch(url, options);
        clearTimeout(timeoutId);
        let data;
        try {
            data = await res.json();
        } catch {
            throw new Error(`服务器返回异常 (${res.status})`);
        }
        if (!res.ok) {
            if (res.status === 401 && authToken) {
                _clearAuthSession();
                throw new Error('UNAUTHORIZED');
            }
            throw new Error(data.message || `请求失败: ${res.status}`);
        }
        return data;
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') err = new Error('请求超时，请稍后重试');
        if (err.message === 'UNAUTHORIZED') throw err;
        if (!silent) showToast(err.message || '网络错误，请检查后端是否启动');
        throw err;
    }
}

// ── 用户认证 ──
let _authConfig = null;

export async function fetchAuthConfig() {
    if (_authConfig) return _authConfig;
    const data = await request('/user/auth-config', 'GET', null, false, DEFAULT_TIMEOUT_MS, true);
    const suffixes = Array.isArray(data.registration_email_suffixes)
        ? data.registration_email_suffixes.filter(Boolean)
        : [];
    _authConfig = {
        registration_email_restriction_enabled: Boolean(data.registration_email_restriction_enabled),
        registration_email_suffixes: suffixes.length
            ? suffixes
            : ['@smail.nju.edu.cn', '@nju.edu.cn'],
    };
    return _authConfig;
}

export async function register(username, email, password, code) {
    return request('/user/register', 'POST', { username, email, password, code }, false);
}
export async function login(email, password) {
    return request('/user/login', 'POST', { email, password }, false, LOGIN_TIMEOUT_MS);
}
export async function logout() {
    return request('/user/logout', 'POST', null, true);
}
export async function requestEmailVerification() {
    return request('/user/email/verification', 'POST');
}
export async function requestRegisterCode(email) {
    return request('/user/email/code', 'POST', { email, purpose: 'register' }, false);
}
export async function requestPasswordResetCode(email) {
    return request('/user/email/code', 'POST', { email, purpose: 'reset_password' }, false);
}
export async function resetPassword(email, code, newPassword) {
    return request('/user/password/reset', 'POST', { email, code, new_password: newPassword }, false);
}
export async function changePassword(currentPassword, newPassword) {
    return request('/user/password/change', 'POST', { current_password: currentPassword, new_password: newPassword });
}
export async function deleteAccount(password) {
    return request('/user/account', 'DELETE', { password });
}

// ── 个人资料（阶段二新增） ──
export async function getMyProfile(silent = false) {
    return request('/me/profile', 'GET', null, true, DEFAULT_TIMEOUT_MS, silent);
}
export async function updateMyProfile({ username, bio, campus, tags, bubble_style } = {}) {
    return request('/me/profile', 'PUT', { username, bio, campus, tags, bubble_style });
}

// ── 吃喝玩乐排行榜 / 探索 ──
export async function getGuideLeaderboard(campus, category, { shuffle = false } = {}) {
    let url = `/places/guide-leaderboard?campus=${encodeURIComponent(campus)}&category=${encodeURIComponent(category)}`;
    if (shuffle) url += '&shuffle=1';
    // 已登录时带 token，刷新后仍能拿到 liked 状态（后端 CORS 已允许 Authorization）
    if (authToken) {
        return request(url, 'GET', null, true, DEFAULT_TIMEOUT_MS, true);
    }
    return requestOptionalAuth(url, 'GET', null, DEFAULT_TIMEOUT_MS, true);
}

/** 同校区多分类榜单一次返回（P0 预取 bundle，减少往返） */
export async function getGuideLeaderboardBundle(campus, categories) {
    const list = Array.isArray(categories) ? categories : [categories];
    const cats = list.filter(Boolean).join(',');
    const url = `/places/guide-leaderboard-bundle?campus=${encodeURIComponent(campus)}&categories=${encodeURIComponent(cats)}`;
    if (authToken) {
        return request(url, 'GET', null, true, DEFAULT_TIMEOUT_MS, true);
    }
    return requestOptionalAuth(url, 'GET', null, DEFAULT_TIMEOUT_MS, true);
}
const GUIDE_EXCLUDED_NAME_KEYWORDS = ['南京大学', '南大', '酒店', '政府部门', '商学院'];
const GUIDE_MAX_DISTANCE_M = 8000;
/** 后端 /places/search 的 page_size 上限 */
const GUIDE_SEARCH_PAGE_SIZE_MAX = 25;
/** 校外分店后缀，如「李记吊笼牛肉汤(南京大学店)」不应被校园关键词误伤 */
const GUIDE_CAMPUS_BRANCH_SUFFIX_RE = /\([^)]*(南京大学|南大)[^)]*店\)/;

function _isExcludedGuideName(name) {
    const normalized = String(name || '').replace(/（/g, '(').replace(/）/g, ')');
    if (!normalized) return true;
    for (const kw of GUIDE_EXCLUDED_NAME_KEYWORDS) {
        if (!normalized.includes(kw)) continue;
        if ((kw === '南京大学' || kw === '南大') && GUIDE_CAMPUS_BRANCH_SUFFIX_RE.test(normalized)) {
            continue;
        }
        return true;
    }
    return false;
}

function _isRecoverableGuideApiError(err) {
    const msg = String(err?.message || '');
    return (
        msg.includes('404')
        || msg.includes('不存在')
        || /not found/i.test(msg)
        || msg.includes('Failed to fetch')
        || msg.includes('需要 place_id')
        || msg.includes('缺少 place_id')
        || err?.name === 'TypeError'
    );
}

function _secureGuideImageUrl(url) {
    if (!url) return '';
    return String(url).replace(/^http:\/\//i, 'https://');
}

function _normalizePoiField(value) {
    if (value == null || value === '') return '';
    if (Array.isArray(value)) return value.map(_normalizePoiField).filter(Boolean).join('');
    return String(value);
}

function _parseLocationPair(location) {
    if (!location) return null;
    const parts = String(location).split(',');
    if (parts.length < 2) return null;
    const lng = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (Number.isNaN(lng) || Number.isNaN(lat)) return null;
    return { lng, lat };
}

function _distanceMeters(from, to) {
    if (!from || !to) return null;
    const rad = Math.PI / 180;
    const dLat = (to.lat - from.lat) * rad;
    const dLng = (to.lng - from.lng) * rad;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(from.lat * rad) * Math.cos(to.lat * rad) * Math.sin(dLng / 2) ** 2;
    return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function _poiToGuideItem(poi, category, campus, origin = null) {
    const biz = poi.biz_ext || {};
    const cost = biz.cost;
    const rawImage = poi.photos?.[0]?.url || '';
    let distance_m = null;
    if (poi.distance != null && poi.distance !== '') {
        const parsed = parseInt(poi.distance, 10);
        if (!Number.isNaN(parsed) && parsed >= 0) distance_m = parsed;
    }
    const poiLoc = _parseLocationPair(poi.location);
    if (distance_m == null && origin && poiLoc) {
        distance_m = _distanceMeters(origin, poiLoc);
    }
    const address = _normalizePoiField(poi.address)
        || _normalizePoiField(poi.addressname)
        || [_normalizePoiField(poi.pname), _normalizePoiField(poi.cityname), _normalizePoiField(poi.adname)]
            .filter(Boolean)
            .join('');
    return {
        poi_id: String(poi.id || '').trim(),
        name: _normalizePoiField(poi.name),
        address,
        desc: address,
        image: _secureGuideImageUrl(rawImage),
        type: category,
        campus,
        rating: _normalizePoiField(biz.rating),
        price: cost ? `¥${_normalizePoiField(cost)}/人` : '',
        location: _normalizePoiField(poi.location),
        distance_m,
        distance_label: distance_m != null ? `${distance_m}m` : '',
        like_count: 0,
        review_count: 0,
        liked: false,
    };
}

function _filterGuideSearchItems(items, { keywordMode = false } = {}) {
    return items.filter((item) => {
        if (_isExcludedGuideName(item.name)) return false;
        if (item.distance_m != null && item.distance_m > GUIDE_MAX_DISTANCE_M) return false;
        if (keywordMode && item.distance_m == null) return Boolean(item.name);
        return Boolean(item.name);
    });
}

function _tipToGuideItem(tip, category, campus, origin) {
    const address = _normalizePoiField(tip.address) || _normalizePoiField(tip.district) || '';
    const loc = _normalizePoiField(tip.location);
    const poiLoc = _parseLocationPair(loc);
    let distance_m = null;
    if (origin && poiLoc) distance_m = _distanceMeters(origin, poiLoc);
    return {
        poi_id: '',
        name: _normalizePoiField(tip.name),
        address,
        desc: address,
        image: '',
        type: category,
        campus,
        rating: '',
        price: '',
        location: loc,
        distance_m,
        distance_label: distance_m != null ? `${distance_m}m` : '',
        like_count: 0,
        review_count: 0,
        liked: false,
    };
}

function _normalizeLocationKey(location) {
    const pair = _parseLocationPair(location);
    if (!pair) return String(location || '').trim().toLowerCase();
    return `${pair.lng.toFixed(4)},${pair.lat.toFixed(4)}`;
}

function _guideSearchDedupeKey(item) {
    const name = (item.name || '').trim().toLowerCase();
    const loc = _normalizeLocationKey(item.location);
    const addr = (item.address || '').trim().toLowerCase();
    if (name && loc) return `nl:${name}|${loc}`;
    if (name && addr) return `na:${name}|${addr}`;
    if (item.poi_id) return `poi:${item.poi_id}`;
    return `raw:${name}|${addr}|${loc}`;
}

function _guideSearchItemRichness(item) {
    return (
        (item.poi_id ? 4 : 0)
        + (item.rating ? 2 : 0)
        + (item.price ? 1 : 0)
        + (item.image ? 1 : 0)
    );
}

function _mergeGuideSearchItemPair(a, b) {
    const base = _guideSearchItemRichness(a) >= _guideSearchItemRichness(b) ? a : b;
    const other = base === a ? b : a;
    return {
        ...base,
        poi_id: base.poi_id || other.poi_id,
        rating: base.rating || other.rating,
        price: base.price || other.price,
        image: base.image || other.image,
        address: base.address || other.address,
        location: base.location || other.location,
        distance_m: base.distance_m ?? other.distance_m,
        distance_label: base.distance_label || other.distance_label,
    };
}

function _mergeGuideSearchItems(...lists) {
    const order = [];
    const byKey = new Map();
    for (const list of lists) {
        for (const item of list) {
            const key = _guideSearchDedupeKey(item);
            if (byKey.has(key)) {
                byKey.set(key, _mergeGuideSearchItemPair(byKey.get(key), item));
            } else {
                byKey.set(key, item);
                order.push(key);
            }
        }
    }
    return order.map((key) => byKey.get(key));
}

function _sortGuideSearchItems(items, keyword) {
    const kw = (keyword || '').trim().toLowerCase();
    if (!kw) {
        return [...items].sort((a, b) => (a.distance_m ?? 999999) - (b.distance_m ?? 999999));
    }
    const score = (item) => {
        const name = (item.name || '').toLowerCase();
        let s = 0;
        if (name === kw) s += 500;
        if (name.includes(kw)) s += 200;
        if (name.startsWith(kw)) s += 80;
        for (const ch of kw) {
            if (name.includes(ch)) s += 2;
        }
        return s;
    };
    return [...items].sort((a, b) => {
        const diff = score(b) - score(a);
        if (diff !== 0) return diff;
        return (a.distance_m ?? 999999) - (b.distance_m ?? 999999);
    });
}

async function _searchGuidePlacesByKeyword(campus, category, keyword, page, guideConfig) {
    const campuses = guideConfig?.campuses || {};
    let effectiveCampus = campus;
    if (campus === 'all' || !campuses[campus]) effectiveCampus = '鼓楼';
    const location = campuses[effectiveCampus] || campuses['鼓楼'] || '118.780,32.058';
    const origin = _parseLocationPair(location);
    const city = effectiveCampus === '苏州' ? '苏州' : '南京';
    const pageSize = guideConfig.page_size || 25;
    const trimmedKeyword = (keyword || '').trim();
    const mapPois = (pois) => _filterGuideSearchItems(
        (pois || []).map((poi) => _poiToGuideItem(poi, category, effectiveCampus, origin)),
        { keywordMode: true },
    );

    let items = [];
    try {
        const suggestData = await getPlaceSuggestions(trimmedKeyword, city, location);
        items = _mergeGuideSearchItems(
            items,
            (suggestData.tips || []).map((tip) => _tipToGuideItem(tip, category, effectiveCampus, origin)),
        );
    } catch {
        // suggestions 失败时继续用 POI 搜索
    }

    try {
        const around = await searchPlaces(
            trimmedKeyword,
            city,
            location,
            1,
            GUIDE_SEARCH_PAGE_SIZE_MAX,
            10000,
            null,
            'weight',
        );
        if (around.status === '1') {
            items = _mergeGuideSearchItems(items, mapPois(around.pois));
        }
    } catch {
        // 周边 POI 失败时仍保留 suggestions 结果
    }

    try {
        const cityWide = await searchPlaces(
            trimmedKeyword,
            city,
            null,
            1,
            GUIDE_SEARCH_PAGE_SIZE_MAX,
            null,
            null,
            'weight',
        );
        if (cityWide.status === '1') {
            items = _mergeGuideSearchItems(items, mapPois(cityWide.pois));
        }
    } catch {
        // 全市检索失败不影响已有结果
    }

    items = _filterGuideSearchItems(items, { keywordMode: true });
    items = _sortGuideSearchItems(items, trimmedKeyword);

    const start = (page - 1) * pageSize;
    const pageItems = items.slice(start, start + pageSize);
    return {
        items: pageItems,
        page,
        page_size: pageSize,
        total: items.length,
        has_more: start + pageSize < items.length,
        campus: effectiveCampus,
        category,
        keyword: trimmedKeyword,
        campus_fallback: campus === 'all' || !campuses[campus],
    };
}

/** 旧版后端无 /guide-search 时，回退到 /places/search + 前端格式化 */
async function _searchGuidePlacesViaAmap(campus, category, keyword, page, guideConfig) {
    const campuses = guideConfig?.campuses || {};
    const categories = guideConfig?.categories || {};
    let effectiveCampus = campus;
    if (campus === 'all' || !campuses[campus]) effectiveCampus = '鼓楼';
    const cfg = categories[category];
    if (!cfg) {
        return {
            items: [],
            page,
            has_more: false,
            total: 0,
            campus: effectiveCampus,
            category,
            keyword: keyword || '',
            campus_fallback: campus === 'all' || !campuses[campus],
        };
    }

    const location = campuses[effectiveCampus] || campuses['鼓楼'] || '118.780,32.058';
    const origin = _parseLocationPair(location);
    const city = effectiveCampus === '苏州' ? '苏州' : '南京';
    const pageSize = guideConfig.page_size || 25;
    const baseRadius = guideConfig.search_radius || 5000;
    const radius = keyword ? Math.max(baseRadius, GUIDE_MAX_DISTANCE_M) : baseRadius;
    const sortrule = keyword ? 'weight' : (guideConfig.sortrule || 'distance');
    const trimmedKeyword = (keyword || '').trim();

    // 有关键词：与发起组局同源（/places/suggestions），不受美食分类码限制
    if (trimmedKeyword) {
        return _searchGuidePlacesByKeyword(campus, category, trimmedKeyword, page, guideConfig);
    }

    const mapPois = (pois) => _filterGuideSearchItems(
        (pois || []).map((poi) => _poiToGuideItem(poi, category, effectiveCampus, origin)),
    );

    let result = await searchPlaces(
        trimmedKeyword,
        city,
        location,
        page,
        pageSize,
        radius,
        cfg.types,
        sortrule,
    );
    if (result.status !== '1') {
        throw new Error('高德搜索失败');
    }

    let items = mapPois(result.pois);
    let total = items.length;
    try {
        total = parseInt(result.count, 10) || items.length;
    } catch {
        total = items.length;
    }

    return {
        items,
        page,
        page_size: pageSize,
        total,
        has_more: page * pageSize < total,
        campus: effectiveCampus,
        category,
        keyword: trimmedKeyword,
        campus_fallback: campus === 'all' || !campuses[campus],
    };
}

export async function searchGuidePlaces(campus, category, keyword = '', page = 1, guideConfig = null) {
    if (!guideConfig) {
        throw new Error('缺少 guide 配置');
    }
    // 生产环境 guide-search 可能未部署；跨域带 token 会触发预检失败。
    // 统一走高德 /places/search，稳定可用。
    return _searchGuidePlacesViaAmap(campus, category, keyword, page, guideConfig);
}
export async function getPlaceSuggestions(keyword, city = '南京', location = null) {
    let url = `/places/suggestions?keyword=${encodeURIComponent(keyword)}&city=${encodeURIComponent(city)}`;
    if (location) url += `&location=${encodeURIComponent(location)}`;
    return request(url, 'GET', null, false);
}
export async function ensureGuidePlace({ campus, category, item }) {
    return _ensureGuidePlaceWithFallback({ campus, category, item });
}
export async function togglePlaceLike(placeId, liked = null) {
    const body = { place_id: placeId };
    if (liked != null) body.liked = liked;
    return request('/like', 'POST', body);
}

const GUIDE_PLACE_ID_CACHE_KEY = 'njuatlas_guide_place_ids';

function _loadGuidePlaceIdCache() {
    try {
        const raw = sessionStorage.getItem(GUIDE_PLACE_ID_CACHE_KEY);
        if (raw) return new Map(JSON.parse(raw));
    } catch { /* ignore */ }
    return new Map();
}

const _guidePlaceIdCache = _loadGuidePlaceIdCache();

function _persistGuidePlaceIdCache() {
    try {
        sessionStorage.setItem(GUIDE_PLACE_ID_CACHE_KEY, JSON.stringify([..._guidePlaceIdCache.entries()]));
    } catch { /* ignore */ }
}

function _guidePlaceCacheKey(item) {
    if (item?.poi_id) return `poi:${String(item.poi_id).trim()}`;
    const name = (item?.name || '').trim().toLowerCase();
    const addr = (item?.address || '').trim().toLowerCase();
    if (name) return `na:${name}|${addr}`;
    return '';
}

function _resolveGuidePlaceId(item) {
    if (item?.place_id) return item.place_id;
    const key = _guidePlaceCacheKey(item);
    return key ? _guidePlaceIdCache.get(key) : null;
}

/** 供 guide 页 dedupe  inflight 与缓存 place_id 对齐 */
export function resolveGuidePlaceId(item) {
    return _resolveGuidePlaceId(item);
}

function _rememberGuidePlaceId(item, placeId) {
    if (!placeId || !item) return;
    item.place_id = placeId;
    const key = _guidePlaceCacheKey(item);
    if (key) {
        _guidePlaceIdCache.set(key, placeId);
        _persistGuidePlaceIdCache();
    }
}

function _formatGuideLikeResult(result, fallbackPlaceId = null) {
    const likesRaw = result.likes ?? result.like_count;
    return {
        place_id: result.place_id ?? fallbackPlaceId,
        liked: Boolean(result.liked),
        likes: likesRaw != null && likesRaw !== '' ? Number(likesRaw) : null,
        message: result.message,
    };
}

async function _setGuidePlaceLike(placeId, liked) {
    const result = await request(
        '/like',
        'POST',
        { place_id: placeId, liked: Boolean(liked) },
        true,
        DEFAULT_TIMEOUT_MS,
        true,
    );
    return _formatGuideLikeResult(result, placeId);
}

async function _ensureGuidePlaceWithFallback({ campus, category, item }) {
    try {
        return await request(
            '/places/guide/ensure-place',
            'POST',
            { campus, category, item },
            true,
            DEFAULT_TIMEOUT_MS,
            true,
        );
    } catch (err) {
        if (!_isRecoverableGuideApiError(err)) throw err;
    }
    const created = await request('/place', 'POST', {
        name: item?.name,
        address: item?.address || '',
        location: item?.location || '',
        poi_id: item?.poi_id || undefined,
        category,
    }, true, DEFAULT_TIMEOUT_MS, true);
    return { place_id: created.id, likes: 0, liked: false };
}

/** 幂等设置点赞状态（供延迟同步队列调用） */
export async function syncGuideLikeToServer({ campus, category, item, liked }) {
    const targetLiked = Boolean(liked);

    try {
        const result = await request(
            '/places/guide/like',
            'POST',
            { campus, category, item, liked: targetLiked },
            true,
            DEFAULT_TIMEOUT_MS,
            true,
        );
        _rememberGuidePlaceId(item, result.place_id);
        return _formatGuideLikeResult(result);
    } catch (err) {
        if (!_isRecoverableGuideApiError(err)) throw err;
    }

    let placeId = _resolveGuidePlaceId(item);
    if (!placeId) {
        const ensured = await _ensureGuidePlaceWithFallback({ campus, category, item });
        placeId = ensured.place_id;
        _rememberGuidePlaceId(item, placeId);
    }

    const result = await _setGuidePlaceLike(placeId, targetLiked);
    _rememberGuidePlaceId(item, result.place_id ?? placeId);
    return result;
}

export function getGuideLikeKey(item) {
    if (item?.poi_id) return `poi:${String(item.poi_id).trim()}`;
    const name = (item?.name || '').trim().toLowerCase();
    const addr = (item?.address || '').trim().toLowerCase();
    if (name) return `na:${name}|${addr}`;
    const placeId = _resolveGuidePlaceId(item);
    return placeId ? `p:${placeId}` : 'guide:unknown';
}

/** @deprecated 请用 queueGuideLikeChange + syncGuideLikeToServer */
export async function guideLikePlace({ campus, category, item, liked = null }) {
    if (liked != null) {
        return syncGuideLikeToServer({ campus, category, item, liked });
    }
    const current = Boolean(item?.liked);
    return syncGuideLikeToServer({ campus, category, item, liked: !current });
}

// ── 地图搜索 ──
export async function searchPlaces(keyword, city = '南京', location = null, page = 1, pageSize = 25, radius = null, types = null, sortrule = null) {
    let url = `/places/search?keyword=${encodeURIComponent(keyword)}&page=${page}&page_size=${pageSize}`;
    if (city) url += `&city=${encodeURIComponent(city)}`;
    if (location) url += `&location=${encodeURIComponent(location)}`;
    if (radius) url += `&radius=${encodeURIComponent(radius)}`;
    if (types) url += `&types=${encodeURIComponent(types)}`;
    if (sortrule) url += `&sortrule=${encodeURIComponent(sortrule)}`;
    return request(url, 'GET', null, false);
}

// ── AI 聊天 ──
export async function chatRecommend(message, sessionId = null, city = '南京', location = null) {
    const body = { message, city };
    if (sessionId) body.session_id = sessionId;
    if (location) body.location = location;
    return request('/llm/chat_recommend', 'POST', body, true, 30000);
}

/**
 * 流式 AI 推荐。handlers: onMeta({session_id,candidates}), onToken(text), onDone({reply}), onError(message)
 */
export async function chatRecommendStream(message, sessionId = null, city = '南京', location = null, handlers = {}) {
    const url = `${API_BASE}/llm/chat_recommend`;
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const body = { message, city, stream: true };
    if (sessionId) body.session_id = sessionId;
    if (location) body.location = location;

    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        if (res.status === 401) {
            _clearAuthSession();
            throw new Error('UNAUTHORIZED');
        }
        let messageText = `请求失败: ${res.status}`;
        try {
            const data = await res.json();
            messageText = data.message || messageText;
        } catch {
            // ignore
        }
        throw new Error(messageText);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('浏览器不支持流式响应');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let splitAt;
        while ((splitAt = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, splitAt);
            buffer = buffer.slice(splitAt + 2);
            let eventName = 'message';
            let dataLine = '';
            for (const line of block.split('\n')) {
                if (line.startsWith('event:')) eventName = line.slice(6).trim();
                else if (line.startsWith('data:')) dataLine = line.slice(5).trim();
            }
            if (!dataLine) continue;
            const payload = JSON.parse(dataLine);
            if (eventName === 'meta') handlers.onMeta?.(payload);
            else if (eventName === 'token') handlers.onToken?.(payload.text || '');
            else if (eventName === 'done') handlers.onDone?.(payload);
            else if (eventName === 'error') handlers.onError?.(payload.message || 'AI 回复失败');
        }
    }
}

// ── 帖子系统（搭子论坛） ──
export async function createPost({ type, title, content, tags, place_id, event_time, event_end_time, urgency, location, location_name, slots, budget, contact } = {}) {
    return request('/posts', 'POST', { type, title, content, tags, place_id, event_time, event_end_time, urgency, location, location_name, slots, budget, contact });
}
export async function listPosts({ type, tags, place_id, sort, lat, lng, radius, user_id, page, page_size, q, urgency_scope, silent = false } = {}) {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (tags) params.set('tags', Array.isArray(tags) ? tags.join(',') : tags);
    if (place_id) params.set('place_id', place_id);
    if (sort) params.set('sort', sort);
    if (lat) params.set('lat', lat);
    if (lng) params.set('lng', lng);
    if (radius) params.set('radius', radius);
    if (user_id) params.set('user_id', user_id);
    if (page) params.set('page', page);
    if (page_size) params.set('page_size', page_size);
    if (q) params.set('q', q);
    if (urgency_scope) params.set('urgency_scope', urgency_scope);
    const qs = params.toString();
    // 已登录时附带 JWT，后端才会返回 is_liked / participation_status 等个人状态
    return request(`/posts${qs ? '?' + qs : ''}`, 'GET', null, !!authToken, DEFAULT_TIMEOUT_MS, silent);
}
export async function getPost(postId, { prefetch = false, silent = false } = {}) {
    const qs = prefetch ? '?prefetch=1' : '';
    return request(`/posts/${postId}${qs}`, 'GET', null, !!authToken, undefined, silent);
}
export async function updatePost(postId, data) {
    return request(`/posts/${postId}`, 'PUT', data);
}
export async function deletePost(postId, { silent = false } = {}) {
    return request(`/posts/${postId}`, 'DELETE', null, true, undefined, silent);
}
export async function togglePostLike(postId) {
    return request(`/posts/${postId}/like`, 'POST');
}
export async function togglePostFavorite(postId) {
    return request(`/posts/${postId}/favorite`, 'POST');
}
export async function addPostComment(postId, content, parentId = null) {
    return request(`/posts/${postId}/comments`, 'POST', { content, parent_id: parentId });
}
export async function deletePostComment(postId, commentId) {
    return request(`/posts/${postId}/comments/${commentId}`, 'DELETE');
}
export async function participateEvent(postId, status = 'going') {
    return request(`/posts/${postId}/participate`, 'POST', { status });
}
export async function listTags(category = null) {
    const qs = category ? `?category=${category}` : '';
    return request(`/tags${qs}`, 'GET', null, false);
}

// ── 个人中心 ──
export async function getFavorites() {
    return request('/me/favorites', 'GET');
}
export async function getLikes() {
    return request('/me/likes', 'GET');
}
export async function getReviews() {
    return request('/me/reviews', 'GET');
}
export async function getMyPostComments() {
    return request('/me/post-comments', 'GET');
}
export async function getMyActivities() {
    return request('/me/activities', 'GET');
}

export async function getConversationList({ silent = false, timeoutMs = 25000 } = {}) {
    return request('/me/conversations', 'GET', null, true, timeoutMs, silent);
}

export async function getConversationMessages(sessionId) {
    return request(`/llm/conversation/${sessionId}/messages`, 'GET');
}

export async function deleteConversation(sessionId) {
    return request(`/llm/conversation/${sessionId}`, 'DELETE');
}
export async function batchDeleteConversations(sessionIds) {
    return request('/llm/conversations/batch_delete', 'POST', { session_ids: sessionIds });
}

// ── 社交（好友 / 私信 / 通知 / 公开资料）──
export async function getUserProfile(userId) {
    return request(`/social/users/${userId}`, 'GET');
}
export async function searchUsers(q) {
    return request(`/social/users/search?q=${encodeURIComponent(q)}`, 'GET');
}
export async function listFriends() {
    return request('/social/friends', 'GET');
}
export async function listFriendsBundle() {
    return request('/social/friends/bundle', 'GET');
}
export async function listFriendRequests() {
    return request('/social/friends/requests', 'GET');
}
export async function listSentFriendRequests() {
    return request('/social/friends/requests/sent', 'GET');
}
export async function sendFriendRequest(userId) {
    return request('/social/friends/request', 'POST', { user_id: userId });
}
export async function acceptFriendRequest(requestId) {
    return request(`/social/friends/requests/${requestId}/accept`, 'POST');
}
export async function rejectFriendRequest(requestId) {
    return request(`/social/friends/requests/${requestId}/reject`, 'POST');
}
export async function cancelFriendRequest(requestId) {
    return request(`/social/friends/requests/${requestId}/cancel`, 'POST');
}
export async function removeFriend(userId) {
    return request(`/social/friends/${userId}`, 'DELETE');
}
export async function listDmConversations(silent = false) {
    return request('/social/messages/conversations', 'GET', null, true, DEFAULT_TIMEOUT_MS, silent);
}
export async function getDmMessages(
    peerId,
    { page = 1, page_size = 50, tail = false, before_id = null, after_id = null } = {},
    silent = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal = null,
) {
    let url = `/social/messages/${peerId}?page_size=${page_size}`;
    if (tail) url += '&tail=1';
    else if (before_id != null && before_id > 0) url += `&before_id=${before_id}`;
    else url += `&page=${page}`;
    if (after_id != null && after_id >= 0) url += `&after_id=${after_id}`;
    return request(url, 'GET', null, true, timeoutMs, silent, signal);
}
export async function sendDmMessage(peerId, content) {
    return request(`/social/messages/${peerId}`, 'POST', { content }, true, DEFAULT_TIMEOUT_MS, true);
}
export function markDmThreadRead(peerId) {
    return request(`/social/messages/${peerId}/read`, 'POST', null, true, DEFAULT_TIMEOUT_MS, true);
}
export async function getInboxBootstrap() {
    return request('/social/inbox/bootstrap', 'GET', null, true, DEFAULT_TIMEOUT_MS, true);
}
export async function listNotifications({ page = 1, page_size = 30 } = {}) {
    return request(`/social/notifications?page=${page}&page_size=${page_size}`, 'GET');
}
const UNREAD_CACHE_MS = 2000;
let _unreadInflight = null;
let _unreadCache = null;
let _unreadCacheAt = 0;

/** 清除未读数缓存（标记已读后调用） */
export function invalidateUnreadCache() {
    _unreadCache = null;
    _unreadCacheAt = 0;
}

/** 单飞 + 短缓存：避免消息页并行触发多条 unread 打满后端 worker */
export async function getUnreadCounts({ force = false } = {}) {
    const now = Date.now();
    if (!force && _unreadCache && (now - _unreadCacheAt) < UNREAD_CACHE_MS) {
        return _unreadCache;
    }
    if (_unreadInflight) {
        return _unreadInflight;
    }
    _unreadInflight = request('/social/notifications/unread', 'GET', null, true, DEFAULT_TIMEOUT_MS, true)
        .then((data) => {
            _unreadCache = data;
            _unreadCacheAt = Date.now();
            return data;
        })
        .finally(() => {
            _unreadInflight = null;
        });
    return _unreadInflight;
}
export async function markNotificationsRead(ids = null, { excludeTypes = null } = {}) {
    const body = ids
        ? { ids }
        : (excludeTypes?.length ? { exclude_types: excludeTypes } : {});
    return request('/social/notifications/read', 'POST', body);
}
export async function uploadAvatar(dataUrl) {
    return request('/social/me/avatar', 'POST', { avatar: dataUrl }, true, 30000, true);
}
export async function uploadCover(dataUrl) {
    return request('/social/me/cover', 'POST', { cover: dataUrl }, true, 30000, true);
}
