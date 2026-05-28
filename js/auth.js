import { setAuthToken, getAuthToken, login, register, logout, requestEmailVerification } from './api.js';
import { showToast } from './utils.js';

let currentUser = null;

export function isLoggedIn() {
    return !!getAuthToken();
}

export function getUser() {
    return currentUser;
}

export async function doLogin(email, password) {
    const data = await login(email, password);
    setAuthToken(data.access_token);
    currentUser = {
        id: data.id,
        email: data.email,
        username: data.username,
        email_verified: data.email_verified
    };
    return currentUser;
}

export async function doRegister(username, email, password, code) {
    const data = await register(username, email, password, code);
    if (!data.access_token) {
        currentUser = data.user || {
            email,
            username,
            email_verified: false
        };
        return currentUser;
    }

    setAuthToken(data.access_token);
    currentUser = {
        id: data.id,
        email: data.email,
        username: data.username,
        email_verified: data.email_verified
    };
    return currentUser;
}

export async function doLogout() {
    try {
        await logout();
    } catch(e) {}
    setAuthToken(null);
    currentUser = null;
}

export async function resendVerificationEmail() {
    await requestEmailVerification();
    showToast('验证邮件已发送，请查收');
}

export function updateUserFromLogin(data) {
    currentUser = {
        id: data.id,
        email: data.email,
        username: data.username,
        email_verified: data.email_verified
    };
}
