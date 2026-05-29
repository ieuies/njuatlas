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

// 用户认证
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

// 餐厅互动
export async function addRestaurant(name, address, location, poiId) {
    return request('/restaurant', 'POST', { name, address, location, poi_id: poiId });
}
export async function addReview(restaurantId, content, rating = null) {
    return request('/review', 'POST', { restaurant_id: restaurantId, content, rating });
}
export async function toggleLike(restaurantId) {
    return request('/like', 'POST', { restaurant_id: restaurantId });
}
export async function toggleFavorite(restaurantId) {
    return request('/favorite', 'POST', { restaurant_id: restaurantId });
}
export async function getRestaurantStats(restaurantId) {
    return request(`/restaurant/${restaurantId}/stats`, 'GET');
}

// 地图搜索
export async function searchPlaces(keyword, city = '南京', location = null, page = 1, pageSize = 25, radius = null) {
    let url = `/places/search?keyword=${encodeURIComponent(keyword)}&page=${page}&page_size=${pageSize}`;
    if (city) url += `&city=${encodeURIComponent(city)}`;
    if (location) url += `&location=${encodeURIComponent(location)}`;
    if (radius) url += `&radius=${encodeURIComponent(radius)}`;
    return request(url, 'GET', null, false);
}
export async function getHotAreas() {
    return request('/places/hot_areas', 'GET', null, false);
}

// AI 聊天
export async function chatRecommend(message, sessionId = null, city = '南京') {
    const body = { message, city };
    if (sessionId) body.session_id = sessionId;
    return request('/llm/chat_recommend', 'POST', body);
}
export async function getRecommendSlogan(restaurantId) {
    return request(`/llm/recommend_slogan?restaurant_id=${restaurantId}`, 'GET', null, false);
}

// 个人中心
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
