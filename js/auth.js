import { setAuthToken, getAuthToken, login, register, logout, requestEmailVerification, getMyProfile } from './api.js';
import { resetGuideLikeSync, refreshUserGuideLikes } from './guide-like-sync.js';
import { showToast, bumpAvatarVersion } from './utils.js';

let currentUser = readStoredUser();

function readStoredUser() {
    try {
        const raw = localStorage.getItem('current_user');
        if (raw) return JSON.parse(raw);
        const token = getAuthToken();
        if (!token) return null;
        // 解码 JWT payload 获取用户信息
        const payloadPart = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const paddedPayload = payloadPart.padEnd(payloadPart.length + (4 - payloadPart.length % 4) % 4, '=');
        const payload = JSON.parse(atob(paddedPayload));
        return {
            id: Number(payload.sub) || null,
            email: payload.email || '',
            username: payload.email ? payload.email.split('@')[0] : '',
            email_verified: false,
            campus: '',
            avatar_url: '',
            cover_url: '',
            bubble_style: 'atlas-classic',
        };
    } catch(e) {
        localStorage.removeItem('current_user');
        return null;
    }
}

function persistUser(user) {
    currentUser = user;
    if (user) localStorage.setItem('current_user', JSON.stringify(user));
    else localStorage.removeItem('current_user');
}

function userFromAuthPayload(data, fallback = {}) {
    return {
        id: data.id ?? fallback.id ?? null,
        email: data.email ?? fallback.email ?? '',
        username: data.username ?? fallback.username ?? '',
        email_verified: Boolean(data.email_verified ?? fallback.email_verified),
        campus: data.campus ?? fallback.campus ?? '',
        avatar_url: data.avatar_url !== undefined ? (data.avatar_url || '') : (fallback.avatar_url || ''),
        cover_url: data.cover_url !== undefined ? (data.cover_url || '') : (fallback.cover_url || ''),
        bubble_style: data.bubble_style ?? fallback.bubble_style ?? 'atlas-classic',
    };
}

export function isLoggedIn() {
    // 不仅检查 token 存在，还要验证它是否已过期
    const token = getAuthToken();
    if (!token) return false;
    try {
        const payloadPart = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const paddedPayload = payloadPart.padEnd(payloadPart.length + (4 - payloadPart.length % 4) % 4, '=');
        const payload = JSON.parse(atob(paddedPayload));
        const now = Math.floor(Date.now() / 1000);
        // JWT exp 是秒级时间戳
        if (payload.exp && payload.exp < now) {
            // token 已过期，清理
            setAuthToken(null);
            persistUser(null);
            return false;
        }
        return true;
    } catch {
        setAuthToken(null);
        persistUser(null);
        return false;
    }
}

export function getUser() {
    return currentUser;
}

async function notifyAuthSessionChange() {
    resetGuideLikeSync();
    if (getAuthToken()) {
        await refreshUserGuideLikes({ force: true }).catch(() => {});
    }
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('njuatlas:auth-change'));
    }
}

export async function doLogin(email, password) {
    const data = await login(email, password);
    setAuthToken(data.access_token);
    persistUser(userFromAuthPayload(data, { email }));
    await notifyAuthSessionChange();
    return currentUser;
}

export async function doRegister(username, email, password, code) {
    const data = await register(username, email, password, code);
    if (!data.access_token) {
        persistUser(data.user || {
            email,
            username,
            email_verified: false
        });
        return currentUser;
    }

    setAuthToken(data.access_token);
    persistUser(userFromAuthPayload(data, { email, username }));
    await notifyAuthSessionChange();
    return currentUser;
}

export async function doLogout() {
    try {
        await logout();
    } catch(e) {}
    setAuthToken(null);
    persistUser(null);
    await notifyAuthSessionChange();
}

export async function resendVerificationEmail() {
    await requestEmailVerification();
    showToast('验证邮件已发送，请查收');
}

export function updateUserFromLogin(data) {
    persistUser(userFromAuthPayload(data, currentUser || {}));
}

/** 服务端 canonical 头像 404 时，清掉本地 session 里的空壳 avatar_url */
export function clearSelfCanonicalAvatarUrl() {
    const u = getUser();
    if (!u?.id) return;
    if (!/\/users\/\d+\/avatar/.test(u.avatar_url || '')) return;
    updateUserFromLogin({ ...u, avatar_url: '' });
    if (typeof window.updateNavBar === 'function') window.updateNavBar();
}

/** 从服务端拉取最新头像/封面，保证手机与电脑等设备显示一致 */
export async function syncUserMediaFromServer() {
    if (!isLoggedIn()) return null;
    const user = getUser();
    if (!user) return null;
    try {
        const profile = await getMyProfile(true);
        const next = userFromAuthPayload(profile, user);
        const avatarChanged = (next.avatar_url || '') !== (user.avatar_url || '');
        persistUser(next);
        if (avatarChanged && next.avatar_url) bumpAvatarVersion(user.id);
        return next;
    } catch (e) {
        return user;
    }
}
