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

async function request(endpoint, method = 'GET', body = null, needAuth = true, timeoutMs = DEFAULT_TIMEOUT_MS, silent = false) {
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
                authToken = null;
                localStorage.removeItem('access_token');
                localStorage.removeItem('current_user');
                if (typeof window.clearNavUnreadBadges === 'function') window.clearNavUnreadBadges();
                if (typeof window.clearMessagesTabBadges === 'function') window.clearMessagesTabBadges();
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
        if (!silent) showToast(err.message || '网络错误，请检查后端是否启动');
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
export async function getMyProfile() {
    return request('/me/profile', 'GET');
}
export async function updateMyProfile({ username, bio, campus, tags, bubble_style } = {}) {
    return request('/me/profile', 'PUT', { username, bio, campus, tags, bubble_style });
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
            authToken = null;
            localStorage.removeItem('access_token');
            localStorage.removeItem('current_user');
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
export async function listPosts({ type, tags, place_id, sort, lat, lng, radius, user_id, page, page_size, q } = {}) {
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
    const qs = params.toString();
    return request(`/posts${qs ? '?' + qs : ''}`, 'GET', null, false);
}
export async function getPost(postId) {
    return request(`/posts/${postId}`, 'GET', null, true);
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

export async function getConversationList() {
    return request('/me/conversations', 'GET');
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
export async function listDmConversations() {
    return request('/social/messages/conversations', 'GET');
}
export async function getDmMessages(
    peerId,
    { page = 1, page_size = 50, tail = false, after_id = null, wait = null } = {},
    silent = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
) {
    let url = `/social/messages/${peerId}?page=${page}&page_size=${page_size}`;
    if (tail) url += '&tail=1';
    if (after_id != null && after_id >= 0) url += `&after_id=${after_id}`;
    if (wait != null && wait > 0) url += `&wait=${wait}`;
    return request(url, 'GET', null, true, timeoutMs, silent);
}
export async function sendDmMessage(peerId, content) {
    return request(`/social/messages/${peerId}`, 'POST', { content }, true, DEFAULT_TIMEOUT_MS, true);
}
export async function listNotifications({ page = 1, page_size = 30 } = {}) {
    return request(`/social/notifications?page=${page}&page_size=${page_size}`, 'GET');
}
export async function getUnreadCounts() {
    return request('/social/notifications/unread', 'GET');
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
