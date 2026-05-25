import { getFavorites, getLikes, getReviews, getConversations, changePassword } from '../api.js';
import { resendVerificationEmail, getUser, isLoggedIn, doLogout } from '../auth.js';
import { showToast, escapeHtml, formatDate } from '../utils.js';

async function loadFavorites() {
    const data = await getFavorites();
    const container = document.getElementById('favoritesList');
    if (!data.items.length) {
        container.innerHTML = '<p>暂无收藏</p>';
        return;
    }
    container.innerHTML = data.items.map(item => `
        <div>🍽️ ${escapeHtml(item.restaurant.name)} - ${escapeHtml(item.restaurant.address || '')}</div>
    `).join('');
}

async function loadLikes() {
    const data = await getLikes();
    const container = document.getElementById('likesList');
    if (!data.items.length) {
        container.innerHTML = '<p>暂无点赞</p>';
        return;
    }
    container.innerHTML = data.items.map(item => `
        <div>👍 ${escapeHtml(item.restaurant.name)}</div>
    `).join('');
}

async function loadReviews() {
    const data = await getReviews();
    const container = document.getElementById('reviewsList');
    if (!data.items.length) {
        container.innerHTML = '<p>暂无评论</p>';
        return;
    }
    container.innerHTML = data.items.map(item => `
        <div>📝 ${escapeHtml(item.content)} (${item.rating ? '⭐'+item.rating : ''}) - ${escapeHtml(item.restaurant.name)}<br><small>${formatDate(item.created_at)}</small></div>
        <hr>
    `).join('');
}

async function loadConversations() {
    const data = await getConversations();
    const container = document.getElementById('conversationsList');
    if (!data.items.length) {
        container.innerHTML = '<p>暂无对话</p>';
        return;
    }
    container.innerHTML = data.items.map(session => `
        <div>💬 会话 ${session.session_id.slice(0,8)}... 最后消息: ${escapeHtml(session.last_message)} (${formatDate(session.last_at)})</div>
        <hr>
    `).join('');
}

async function handleChangePassword() {
    const oldPwd = document.getElementById('oldPassword').value;
    const newPwd = document.getElementById('newPassword').value;
    if (!oldPwd || !newPwd) return showToast('请填写密码');
    if (newPwd.length < 8) return showToast('新密码至少8位');
    try {
        await changePassword(oldPwd, newPwd);
        showToast('密码已修改，请重新登录');
        await doLogout();
        window.updateNavBar();
    } catch(e) {
        showToast(e.message);
    }
}

export async function refreshProfile() {
    if (!isLoggedIn()) return;
    const user = getUser();
    if (user) {
        document.getElementById('profileUsername').innerText = user.username;
        document.getElementById('profileEmail').innerText = user.email;
        document.getElementById('profileEmailVerified').innerHTML = user.email_verified ? '已验证 ✅' : '未验证 ❌';
    }
    await Promise.all([loadFavorites(), loadLikes(), loadReviews(), loadConversations()]);
}

export function initProfilePage() {
    document.getElementById('changePasswordBtn').onclick = handleChangePassword;
    document.getElementById('sendVerifyEmailBtn').onclick = async () => {
        if (!isLoggedIn()) return;
        await resendVerificationEmail();
        showToast('验证邮件已发送');
    };
    refreshProfile();
}