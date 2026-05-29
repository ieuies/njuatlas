import { getFavorites, getLikes, getReviews, getConversations, changePassword } from '../api.js';
import { resendVerificationEmail, getUser, isLoggedIn, doLogout } from '../auth.js';
import { showToast, escapeHtml, formatDate } from '../utils.js';

const sections = {
    favorites: { listId: 'favoritesList', countId: 'favoriteCount', empty: '还没有收藏餐厅' },
    likes: { listId: 'likesList', countId: 'likeCount', empty: '还没有点赞餐厅' },
    reviews: { listId: 'reviewsList', countId: 'reviewCount', empty: '还没有发表评价' },
    conversations: { listId: 'conversationsList', countId: 'conversationCount', empty: '还没有 AI 对话' },
};

function setLoading(sectionKey) {
    const section = sections[sectionKey];
    const container = document.getElementById(section.listId);
    if (container) container.innerHTML = '<div class="profile-empty">加载中...</div>';
}

function setCount(sectionKey, count) {
    const el = document.getElementById(sections[sectionKey].countId);
    if (el) el.innerText = String(count);
}

function renderEmpty(sectionKey) {
    return `<div class="profile-empty">${sections[sectionKey].empty}</div>`;
}

function restaurantLine(restaurant) {
    if (!restaurant) return '<span class="profile-muted">餐厅信息已不可用</span>';
    const address = restaurant.address ? `<p>${escapeHtml(restaurant.address)}</p>` : '';
    return `
        <strong>${escapeHtml(restaurant.name || '未命名餐厅')}</strong>
        ${address}
    `;
}

function renderRestaurantItems(sectionKey, items) {
    const container = document.getElementById(sections[sectionKey].listId);
    setCount(sectionKey, items.length);
    if (!items.length) {
        container.innerHTML = renderEmpty(sectionKey);
        return;
    }

    container.innerHTML = items.map(item => `
        <article class="profile-list-item">
            <div>${restaurantLine(item.restaurant)}</div>
            <time>${formatDate(item.created_at)}</time>
        </article>
    `).join('');
}

function renderReviews(items) {
    const container = document.getElementById(sections.reviews.listId);
    setCount('reviews', items.length);
    if (!items.length) {
        container.innerHTML = renderEmpty('reviews');
        return;
    }

    container.innerHTML = items.map(item => `
        <article class="profile-list-item">
            <div>
                <strong>${escapeHtml(item.restaurant?.name || '未命名餐厅')}</strong>
                <p>${escapeHtml(item.content)}</p>
                ${item.rating ? `<span class="profile-tag">${item.rating} 分</span>` : ''}
            </div>
            <time>${formatDate(item.created_at)}</time>
        </article>
    `).join('');
}

function renderConversations(items) {
    const container = document.getElementById(sections.conversations.listId);
    setCount('conversations', items.length);
    if (!items.length) {
        container.innerHTML = renderEmpty('conversations');
        return;
    }

    container.innerHTML = items.map(session => `
        <article class="profile-list-item">
            <div>
                <strong>会话 ${escapeHtml(session.session_id.slice(0, 8))}</strong>
                <p>${escapeHtml(session.last_message || '')}</p>
                <span class="profile-tag">${session.message_count || 0} 条消息</span>
            </div>
            <time>${formatDate(session.last_at)}</time>
        </article>
    `).join('');
}

async function loadSection(sectionKey, loader, renderer) {
    const container = document.getElementById(sections[sectionKey].listId);
    if (!container) return;
    setLoading(sectionKey);
    try {
        const data = await loader();
        renderer(data.items || []);
    } catch(e) {
        setCount(sectionKey, 0);
        container.innerHTML = '<div class="profile-empty">加载失败，请稍后重试</div>';
    }
}

async function handleChangePassword() {
    const oldPwd = document.getElementById('oldPassword').value;
    const newPwd = document.getElementById('newPassword').value;
    const button = document.getElementById('changePasswordBtn');
    if (!oldPwd || !newPwd) return showToast('请填写当前密码和新密码');
    if (newPwd.length < 8) return showToast('新密码至少 8 位');

    const originalText = button.innerText;
    button.disabled = true;
    button.innerText = '提交中...';
    try {
        await changePassword(oldPwd, newPwd);
        showToast('密码已修改，请重新登录');
        await doLogout();
        window.updateNavBar();
    } catch(e) {
        showToast(e.message);
    } finally {
        button.disabled = false;
        button.innerText = originalText;
    }
}

function renderUser() {
    const user = getUser();
    const usernameEl = document.getElementById('profileUsername');
    const emailEl = document.getElementById('profileEmail');
    const statusEl = document.getElementById('profileEmailVerified');
    const resendBtn = document.getElementById('sendVerifyEmailBtn');

    const email = user?.email || '';
    const username = user?.username || (email ? email.split('@')[0] : '个人中心');
    usernameEl.innerText = username;
    emailEl.innerText = email || '未读取到邮箱信息';

    const verified = Boolean(user?.email_verified);
    statusEl.innerText = verified ? '邮箱已验证' : '邮箱未验证';
    statusEl.className = `profile-status ${verified ? 'is-verified' : 'is-unverified'}`;
    resendBtn.style.display = verified ? 'none' : 'inline-flex';
}

export async function refreshProfile() {
    if (!isLoggedIn()) return;
    renderUser();
    await Promise.all([
        loadSection('favorites', getFavorites, items => renderRestaurantItems('favorites', items)),
        loadSection('likes', getLikes, items => renderRestaurantItems('likes', items)),
        loadSection('reviews', getReviews, renderReviews),
        loadSection('conversations', getConversations, renderConversations),
    ]);
}

export function initProfilePage() {
    document.getElementById('changePasswordBtn').onclick = handleChangePassword;
    document.getElementById('sendVerifyEmailBtn').onclick = async () => {
        if (!isLoggedIn()) return;
        const button = document.getElementById('sendVerifyEmailBtn');
        const originalText = button.innerText;
        button.disabled = true;
        button.innerText = '发送中...';
        try {
            await resendVerificationEmail();
        } catch(e) {
            showToast(e.message);
        } finally {
            button.disabled = false;
            button.innerText = originalText;
        }
    };
    refreshProfile();
}
