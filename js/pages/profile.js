import { getFavorites, getLikes, getReviews, getConversations, changePassword, deleteAccount, getMyProfile, updateMyProfile, listPosts } from '../api.js';
import { resendVerificationEmail, getUser, isLoggedIn, doLogout } from '../auth.js';
import { showToast, escapeHtml, formatDate } from '../utils.js';

let currentProfileTab = 'posts';

/* ================================================================
   个人中心头部渲染
   ================================================================ */
function renderProfileHeader() {
    const user = getUser();
    const email = user?.email || '';
    const username = user?.username || (email ? email.split('@')[0] : '同学');

    // 用户名
    const usernameEl = document.getElementById('profileUsername');
    if (usernameEl) usernameEl.innerText = username;

    // 邮箱
    const emailLine = document.getElementById('profileEmailLine');
    if (emailLine) emailLine.innerText = email ? `📧 ${email}` : '';

    // 头像
    renderAvatar(user);

    // 个人简介
    loadAndRenderBio();

    // 邮箱验证状态
    const statusEl = document.getElementById('profileEmailVerified');
    const resendBtn = document.getElementById('sendVerifyEmailBtn');
    const verified = Boolean(user?.email_verified);
    if (statusEl) {
        statusEl.innerText = verified ? '✓ 邮箱已验证' : '⚠ 邮箱未验证';
        statusEl.className = `profile-status ${verified ? 'is-verified' : 'is-unverified'}`;
    }
    if (resendBtn) resendBtn.style.display = verified ? 'none' : 'inline-flex';
}

function renderAvatar(user) {
    const avatarEls = [
        document.getElementById('profileAvatarLarge'),
        document.getElementById('editAvatarPreview'),
    ];
    const name = user?.username || (user?.email ? user.email.split('@')[0] : '同学');
    const initial = name.charAt(0).toUpperCase();
    const hue = [...name].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
    const bg = `hsl(${hue}, 55%, 55%)`;

    avatarEls.forEach(el => {
        if (!el) return;
        el.innerHTML = `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:2rem;font-weight:800;color:#fff;background:${bg};border-radius:50%;">${initial}</span>`;
        el.style.background = bg;
    });
}

async function loadAndRenderBio() {
    const bioEl = document.getElementById('profileBio');
    if (!bioEl) return;
    try {
        const profile = await getMyProfile();
        if (profile.bio) {
            bioEl.innerText = profile.bio;
        }
        // 预填编辑表单
        const editUsername = document.getElementById('editUsername');
        const editBio = document.getElementById('editBio');
        const editTags = document.getElementById('editTags');
        if (editUsername) editUsername.value = profile.username || '';
        if (editBio) editBio.value = profile.bio || '';
        if (editTags) editTags.value = (profile.tags || []).join(', ');
    } catch (e) {
        // 静默失败，保留默认 bio
    }
}

/* ================================================================
   Tab 切换
   ================================================================ */
function initProfileTabs() {
    const tabs = document.querySelectorAll('.profile-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.getAttribute('data-profile-tab');
            switchProfileTab(tabId);
        });
    });
}

function switchProfileTab(tabId) {
    currentProfileTab = tabId;
    document.querySelectorAll('.profile-tab').forEach(t => {
        t.classList.toggle('active', t.getAttribute('data-profile-tab') === tabId);
    });
    loadProfileTabContent(tabId);
}

async function loadProfileTabContent(tabId) {
    const container = document.getElementById('profileTabContent');
    if (!container) return;
    container.innerHTML = '<div class="profile-loading">加载中...</div>';

    try {
        switch (tabId) {
            case 'posts': await renderMyPosts(container); break;
            case 'comments': await renderMyComments(container); break;
            case 'favorites': await renderMyFavorites(container); break;
            case 'activities': await renderMyActivities(container); break;
        }
    } catch (e) {
        container.innerHTML = '<div class="profile-empty-state">加载失败，请稍后重试</div>';
    }
}

/* ================================================================
   我发布的
   ================================================================ */
async function renderMyPosts(container) {
    const user = getUser();
    if (!user?.id) {
        container.innerHTML = '<div class="profile-empty-state"><i class="fas fa-file-alt"></i>请先登录</div>';
        return;
    }
    try {
        const data = await listPosts({ user_id: user.id, page_size: 50 });
        const posts = data.items || [];
        document.getElementById('postCount').innerText = posts.length;
        if (!posts.length) {
            container.innerHTML = '<div class="profile-empty-state"><i class="fas fa-file-alt"></i>还没有发布过组局</div>';
            return;
        }
        container.innerHTML = posts.map(p => `
            <article class="profile-content-card" data-post-id="${p.id}">
                <div class="profile-content-card-title">${escapeHtml(p.title || '无标题')}</div>
                <div class="profile-content-card-body">${escapeHtml((p.content || p.description || '').substring(0, 150))}</div>
                <div class="profile-content-card-meta">
                    <span><i class="fas fa-tag"></i> ${escapeHtml(p.category || p.type || '')}</span>
                    <span><i class="fas fa-clock"></i> ${formatDate(p.created_at)}</span>
                    <span><i class="fas fa-heart"></i> ${p.like_count || 0} 赞</span>
                    <span><i class="fas fa-comment"></i> ${p.comment_count || 0} 评</span>
                </div>
            </article>
        `).join('');
        // 点击卡片打开详情
        container.querySelectorAll('.profile-content-card').forEach(card => {
            card.addEventListener('click', () => {
                const postId = parseInt(card.getAttribute('data-post-id'));
                if (postId && typeof window.openPostDetail === 'function') {
                    window.openPostDetail(postId);
                }
            });
            card.style.cursor = 'pointer';
        });
        // 更新获赞数统计
        const totalLikes = posts.reduce((sum, p) => sum + (p.like_count || 0), 0);
        document.getElementById('likeReceivedCount').innerText = totalLikes;
    } catch (e) {
        container.innerHTML = '<div class="profile-empty-state">加载失败，请稍后重试</div>';
    }
}

/* ================================================================
   我的评论
   ================================================================ */
async function renderMyComments(container) {
    try {
        // 从 reviews API 获取场所评论
        const [reviewsData, conversationsData] = await Promise.all([
            getReviews().catch(() => ({ items: [] })),
            getConversations().catch(() => ({ items: [] })),
        ]);
        const reviews = reviewsData.items || [];
        const comments = [];

        // 场所评论
        reviews.forEach(r => {
            comments.push({
                type: 'place',
                content: r.content || '',
                placeName: r.place?.name || '未知场所',
                time: r.created_at,
                rating: r.rating,
            });
        });

        document.getElementById('commentMadeCount').innerText = comments.length;
        if (!comments.length) {
            container.innerHTML = '<div class="profile-empty-state"><i class="fas fa-comment"></i>还没有发表过评论</div>';
            return;
        }
        container.innerHTML = comments.map(c => `
            <article class="profile-content-card">
                <div class="profile-content-card-title">
                    <i class="fas fa-map-marker-alt"></i> ${escapeHtml(c.placeName)}
                </div>
                <div class="profile-content-card-body">${escapeHtml(c.content)}</div>
                <div class="profile-content-card-meta">
                    <span><i class="fas fa-clock"></i> ${formatDate(c.time)}</span>
                    ${c.rating ? `<span><i class="fas fa-star"></i> ${c.rating} 分</span>` : ''}
                </div>
            </article>
        `).join('');
    } catch (e) {
        container.innerHTML = '<div class="profile-empty-state">加载失败，请稍后重试</div>';
    }
}

/* ================================================================
   我的收藏
   ================================================================ */
async function renderMyFavorites(container) {
    try {
        const [favData, likeData] = await Promise.all([
            getFavorites().catch(() => ({ items: [] })),
            getLikes().catch(() => ({ items: [] })),
        ]);
        const items = [
            ...(favData.items || []).map(i => ({ ...i, favType: '收藏' })),
            ...(likeData.items || []).map(i => ({ ...i, favType: '点赞' })),
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        document.getElementById('favoriteCount2').innerText = items.length;
        if (!items.length) {
            container.innerHTML = '<div class="profile-empty-state"><i class="fas fa-heart"></i>还没有收藏或点赞</div>';
            return;
        }
        container.innerHTML = items.map(item => `
            <article class="profile-content-card">
                <div class="profile-content-card-title">
                    ${escapeHtml(item.place?.name || '未知场所')}
                </div>
                <div class="profile-content-card-body">
                    ${item.place?.address ? escapeHtml(item.place.address) : ''}
                </div>
                <div class="profile-content-card-meta">
                    <span class="profile-tag">${item.favType}</span>
                    <span><i class="fas fa-clock"></i> ${formatDate(item.created_at)}</span>
                </div>
            </article>
        `).join('');
    } catch (e) {
        container.innerHTML = '<div class="profile-empty-state">加载失败，请稍后重试</div>';
    }
}

/* ================================================================
   我的活动（参加的组局）
   ================================================================ */
async function renderMyActivities(container) {
    try {
        // 尝试获取用户参与的帖子（通过 listPosts API 获取所有帖子并筛选参与者）
        const data = await listPosts({ page_size: 100 });
        const user = getUser();
        const allPosts = data.items || [];
        // 客户端筛选：找到用户参与的活动
        const myActivities = allPosts.filter(p =>
            (p.participants || []).some(part =>
                part.user_id === user?.id || part.username === user?.username
            )
        );

        if (!myActivities.length) {
            container.innerHTML = '<div class="profile-empty-state"><i class="fas fa-calendar"></i>还没有参加过组局活动</div>';
            return;
        }
        container.innerHTML = myActivities.map(p => `
            <article class="profile-content-card" data-post-id="${p.id}">
                <div class="profile-content-card-title">${escapeHtml(p.title || '无标题')}</div>
                <div class="profile-content-card-body">${escapeHtml((p.content || p.description || '').substring(0, 120))}</div>
                <div class="profile-content-card-meta">
                    <span><i class="fas fa-tag"></i> ${escapeHtml(p.category || p.type || '')}</span>
                    <span><i class="fas fa-clock"></i> ${formatDate(p.created_at)}</span>
                    <span><i class="fas fa-users"></i> ${p.participant_count || 0} 人参与</span>
                </div>
            </article>
        `).join('');
        container.querySelectorAll('.profile-content-card').forEach(card => {
            card.addEventListener('click', () => {
                const postId = parseInt(card.getAttribute('data-post-id'));
                if (postId && typeof window.openPostDetail === 'function') {
                    window.openPostDetail(postId);
                }
            });
            card.style.cursor = 'pointer';
        });
    } catch (e) {
        container.innerHTML = '<div class="profile-empty-state">加载失败，请稍后重试</div>';
    }
}

/* ================================================================
   编辑个人资料（含密码修改与账号注销）
   ================================================================ */
function initEditProfile() {
    const modal = document.getElementById('editProfileModal');
    const openBtn = document.getElementById('editProfileBtn');
    const closeBtn = document.getElementById('closeEditProfileBtn');
    const cancelBtn = document.getElementById('cancelEditProfileBtn');
    const form = document.getElementById('editProfileForm');
    const deleteBtn = document.getElementById('deleteAccountBtn');

    openBtn?.addEventListener('click', async () => {
        // 预填当前值，清空密码字段
        document.getElementById('editOldPassword').value = '';
        document.getElementById('editNewPassword').value = '';
        document.getElementById('deleteAccountPassword').value = '';
        try {
            const profile = await getMyProfile();
            document.getElementById('editUsername').value = profile.username || '';
            document.getElementById('editBio').value = profile.bio || '';
            document.getElementById('editTags').value = (profile.tags || []).join(', ');
        } catch (e) { /* 使用默认值 */ }
        modal.style.display = 'flex';
    });

    closeBtn?.addEventListener('click', () => { modal.style.display = 'none'; });
    cancelBtn?.addEventListener('click', () => { modal.style.display = 'none'; });
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
    });

    // 保存：更新资料 + 可选修改密码
    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('editUsername').value.trim();
        const bio = document.getElementById('editBio').value.trim();
        const tagsStr = document.getElementById('editTags').value.trim();
        const tags = tagsStr ? tagsStr.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [];
        const oldPwd = document.getElementById('editOldPassword').value;
        const newPwd = document.getElementById('editNewPassword').value;

        const saveBtn = document.getElementById('saveProfileBtn');
        const originalText = saveBtn.innerText;
        saveBtn.disabled = true;
        saveBtn.innerText = '保存中...';
        try {
            // 更新个人资料
            await updateMyProfile({ username, bio, tags });
            // 如果填了新密码，则同时修改密码
            if (newPwd) {
                if (!oldPwd) { showToast('请输入当前密码以修改密码'); saveBtn.disabled = false; saveBtn.innerText = originalText; return; }
                if (newPwd.length < 8) { showToast('新密码至少 8 位'); saveBtn.disabled = false; saveBtn.innerText = originalText; return; }
                await changePassword(oldPwd, newPwd);
                showToast('资料和密码已更新');
            } else {
                showToast('资料已更新');
            }
            modal.style.display = 'none';
            if (username) document.getElementById('profileUsername').innerText = username;
            if (bio) document.getElementById('profileBio').innerText = bio;
        } catch (err) {
            showToast(err.message || '保存失败');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerText = originalText;
        }
    });

    // 注销账号
    deleteBtn?.addEventListener('click', async () => {
        const password = document.getElementById('deleteAccountPassword').value;
        if (!password) return showToast('请输入密码以确认注销');
        if (!confirm('确定要注销账号吗？此操作不可撤销，所有数据将被永久删除！')) return;

        const originalText = deleteBtn.innerText;
        deleteBtn.disabled = true;
        deleteBtn.innerText = '注销中...';
        try {
            await deleteAccount(password);
            showToast('账号已注销');
            modal.style.display = 'none';
            await doLogout();
            window.updateNavBar();
            window.switchPage('home');
        } catch (err) {
            showToast(err.message || '注销失败，请确认密码正确');
        } finally {
            deleteBtn.disabled = false;
            deleteBtn.innerText = originalText;
        }
    });
}

/* ================================================================
   初始化 & 刷新
   ================================================================ */
export async function refreshProfile() {
    if (!isLoggedIn()) return;
    renderProfileHeader();
    loadProfileTabContent(currentProfileTab);
}

export function initProfilePage() {
    initProfileTabs();
    initEditProfile();

    // 重新发送验证邮件
    const verifyBtn = document.getElementById('sendVerifyEmailBtn');
    if (verifyBtn) {
        verifyBtn.onclick = async () => {
            if (!isLoggedIn()) return;
            const btn = verifyBtn;
            const originalText = btn.innerText;
            btn.disabled = true;
            btn.innerText = '发送中...';
            try {
                await resendVerificationEmail();
                showToast('验证邮件已发送，请查收');
            } catch (e) {
                showToast(e.message);
            } finally {
                btn.disabled = false;
                btn.innerText = originalText;
            }
        };
    }

    refreshProfile();
}
