import { API_BASE } from './config.js';
import { showToast } from './utils.js';

let authToken = localStorage.getItem('access_token') || null;
const DEFAULT_TIMEOUT_MS = 12000;
const LOGIN_TIMEOUT_MS = 10000;

export function setAuthToken(token) {
    authToken = token;
    if (token) localStorage.setItem('access_token', token);
    else localStorage.removeItem('access_token');
}

export function getAuthToken() {
    return authToken;
}

async function request(endpoint, method = 'GET', body = null, needAuth = true, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const url = `${API_BASE}${endpoint}`;
    const headers = { 'Content-Type': 'application/json' };
    if (needAuth && authToken) headers['Authorization'] = `Bearer ${authToken}`;
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
        } catch (jsonErr) {
            const text = await res.text();
            console.error('API非JSON响应:', res.status, text);
            throw new Error(`服务器返回异常 (${res.status})`);
        }
        if (!res.ok) {
            if (res.status === 401 && needAuth) {
                throw new Error('UNAUTHORIZED');
            }
            throw new Error(data.message || `请求失败: ${res.status}`);
        }
        return data;
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            err = new Error('请求超时，请稍后重试');
        }
        if (err.message === 'UNAUTHORIZED') throw err;
        console.error('API请求错误:', err);
        showToast(err.message || '网络错误，请检查后端是否启动');
        throw err;
    }
}

// ── 用户认证 ──
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
export async function verifyEmail(token) {
    return request('/user/email/verify', 'POST', { token }, false);
}
export async function forgotPassword(email) {
    return request('/user/email/code', 'POST', { email, purpose: 'reset_password' }, false);
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

// ── 个人资料（阶段二新增） ──
export async function getMyProfile() {
    return request('/me/profile', 'GET');
}
export async function updateMyProfile({ username, bio, tags } = {}) {
    return request('/me/profile', 'PUT', { username, bio, tags });
}

// ── 场所互动 ──
export async function addPlace(name, address, location, poiId, category = null) {
    return request('/place', 'POST', { name, address, location, poi_id: poiId, category });
}
export async function addReview(placeId, content, rating = null) {
    return request('/review', 'POST', { place_id: placeId, content, rating });
}
export async function toggleLike(placeId) {
    return request('/like', 'POST', { place_id: placeId });
}
export async function toggleFavorite(placeId) {
    return request('/favorite', 'POST', { place_id: placeId });
}
export async function getPlaceStats(placeId) {
    return request(`/place/${placeId}/stats`, 'GET', null, false);
}

// ── 地图搜索 ──
export async function searchPlaces(keyword, city = '南京', location = null, page = 1, pageSize = 25, radius = null, types = null) {
    let url = `/places/search?keyword=${encodeURIComponent(keyword)}&page=${page}&page_size=${pageSize}`;
    if (city) url += `&city=${encodeURIComponent(city)}`;
    if (location) url += `&location=${encodeURIComponent(location)}`;
    if (radius) url += `&radius=${encodeURIComponent(radius)}`;
    if (types) url += `&types=${encodeURIComponent(types)}`;
    return request(url, 'GET', null, false);
}
export async function getHotAreas() {
    return request('/places/hot_areas', 'GET', null, false);
}
export async function getPlaceCategories() {
    return request('/places/categories', 'GET', null, false);
}
export async function geocode(address, city = null) {
    let url = `/places/geocode?address=${encodeURIComponent(address)}`;
    if (city) url += `&city=${encodeURIComponent(city)}`;
    return request(url, 'GET', null, false);
}
export async function regeocode(location) {
    return request(`/places/regeocode?location=${encodeURIComponent(location)}`, 'GET', null, false);
}

// ── AI 聊天 ──
export async function chatRecommend(message, sessionId = null, city = '南京') {
    const body = { message, city };
    if (sessionId) body.session_id = sessionId;
    return request('/llm/chat_recommend', 'POST', body);
}
export async function getRecommendSlogan(placeId) {
    return request(`/llm/recommend_slogan?place_id=${placeId}`, 'GET', null, false);
}

// ── 帖子系统（搭子论坛） ──
export async function createPost({ type, title, content, tags, place_id, event_time, location, location_name } = {}) {
    return request('/posts', 'POST', { type, title, content, tags, place_id, event_time, location, location_name });
}
export async function listPosts({ type, tags, place_id, sort, lat, lng, radius, user_id, page, page_size } = {}) {
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
    const qs = params.toString();
    return request(`/posts${qs ? '?' + qs : ''}`, 'GET', null, false);
}
export async function getPost(postId) {
    return request(`/posts/${postId}`, 'GET', null, false);
}
export async function updatePost(postId, data) {
    return request(`/posts/${postId}`, 'PUT', data);
}
export async function deletePost(postId) {
    return request(`/posts/${postId}`, 'DELETE');
}
export async function togglePostLike(postId) {
    return request(`/posts/${postId}/like`, 'POST');
}
export async function addPostComment(postId, content, parentId = null) {
    return request(`/posts/${postId}/comments`, 'POST', { content, parent_id: parentId });
}
export async function getPostComments(postId, page = 1, pageSize = 20) {
    return request(`/posts/${postId}/comments?page=${page}&page_size=${pageSize}`, 'GET', null, false);
}
export async function participateEvent(postId, status = 'going') {
    return request(`/posts/${postId}/participate`, 'POST', { status });
}
export async function listTags(category = null) {
    const qs = category ? `?category=${category}` : '';
    return request(`/tags${qs}`, 'GET', null, false);
}
export async function getMyTags() {
    return request('/me/tags', 'GET');
}
export async function setMyTags(tags) {
    return request('/me/tags', 'PUT', { tags });
}
export async function getPlacePosts(placeId, page = 1, pageSize = 10) {
    return request(`/places/${placeId}/posts?page=${page}&page_size=${pageSize}`, 'GET', null, false);
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
export async function getConversations() {
    return request('/me/conversations', 'GET');
}
