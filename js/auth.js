import { setAuthToken, getAuthToken, login, register, logout, requestEmailVerification } from './api.js';
import { showToast } from './utils.js';

let currentUser = readStoredUser();

function readStoredUser() {
    try {
        const raw = localStorage.getItem('current_user');
        if (raw) return JSON.parse(raw);
        const token = getAuthToken();
        if (!token) return null;
        const payloadPart = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const paddedPayload = payloadPart.padEnd(payloadPart.length + (4 - payloadPart.length % 4) % 4, '=');
        const payload = JSON.parse(atob(paddedPayload));
        return {
            id: Number(payload.sub) || null,
            email: payload.email || '',
            username: payload.email ? payload.email.split('@')[0] : '',
            email_verified: false
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
        email_verified: Boolean(data.email_verified ?? fallback.email_verified)
    };
}

export function isLoggedIn() {
    return !!getAuthToken();
}

export function getUser() {
    return currentUser;
}

export async function doLogin(email, password) {
    const data = await login(email, password);
    setAuthToken(data.access_token);
    persistUser(userFromAuthPayload(data, { email }));
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
    return currentUser;
}

export async function doLogout() {
    try {
        await logout();
    } catch(e) {}
    setAuthToken(null);
    persistUser(null);
}

export async function resendVerificationEmail() {
    await requestEmailVerification();
    showToast('验证邮件已发送，请查收');
}

export function updateUserFromLogin(data) {
    persistUser(userFromAuthPayload(data, currentUser || {}));
}
