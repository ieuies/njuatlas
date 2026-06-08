// ================================================================
// profile.js - 个人中心模块（含封面裁剪高清版）
// ================================================================

import { getFavorites, getLikes, getReviews, getMyPostComments, changePassword, deleteAccount, getMyProfile, updateMyProfile, listPosts } from '../api.js';
import { resendVerificationEmail, getUser, isLoggedIn, doLogout } from '../auth.js';
import { showToast, escapeHtml, formatDate } from '../utils.js';

let currentProfileTab = 'posts';
let _profileBioCache = null;

const CROPPER_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.css';
const CROPPER_JS = 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.js';
let _cropperLoadPromise = null;

function ensureCropperLoaded() {
    if (typeof window.Cropper !== 'undefined') return Promise.resolve();
    if (_cropperLoadPromise) return _cropperLoadPromise;
    _cropperLoadPromise = new Promise((resolve, reject) => {
        if (!document.querySelector('link[data-cropper-css]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = CROPPER_CSS;
            link.dataset.cropperCss = '1';
            document.head.appendChild(link);
        }
        const existing = document.querySelector('script[data-cropper-js]');
        if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error('Cropper 加载失败')), { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = CROPPER_JS;
        script.dataset.cropperJs = '1';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Cropper 加载失败'));
        document.head.appendChild(script);
    });
    return _cropperLoadPromise;
}

// 封面相关常量
const COVER_PRESETS = [
    'https://picsum.photos/id/104/1920/720',
    'https://picsum.photos/id/15/1920/720',
    'https://picsum.photos/id/96/1920/720',
    'https://picsum.photos/id/42/1920/720',
    'https://picsum.photos/id/29/1920/720',
];

// 获取当前用户的封面存储 Key（用户隔离）
function getCoverStorageKey() {
    const user = getUser();
    if (!user || !user.id) return null;
    return `user_cover_${user.id}`;
}

// ========== 封面功能（高清裁剪） ==========
let cropper = null;

function loadProfileCover() {
    const coverDiv = document.getElementById('profileCover');
    if (!coverDiv) return;
    const storageKey = getCoverStorageKey();
    if (!storageKey) return;
    let coverUrl = localStorage.getItem(storageKey);
    if (!coverUrl) {
        const randomIndex = Math.floor(Math.random() * COVER_PRESETS.length);
        coverUrl = COVER_PRESETS[randomIndex];
        localStorage.setItem(storageKey, coverUrl);
    }
    coverDiv.style.backgroundImage = `url('${coverUrl}')`;
}

function saveCoverFromCropped(canvas) {
    return new Promise((resolve, reject) => {
        const storageKey = getCoverStorageKey();
        if (!storageKey) {
            reject(new Error('请先登录'));
            return;
        }
        // 输出高清图片：宽度 1920px，高度 720px（保持 16:6 比例）
        // 使用最高质量 JPEG（也可改为 PNG / WebP）
        const base64 = canvas.toDataURL('image/jpeg', 1.0);
        localStorage.setItem(storageKey, base64);
        const coverDiv = document.getElementById('profileCover');
        if (coverDiv) coverDiv.style.backgroundImage = `url('${base64}')`;
        resolve();
    });
}

function openCropModal(file) {
    return new Promise((resolve, reject) => {
        const modal = document.getElementById('cropModal');
        const img = document.getElementById('cropImage');
        const confirmBtn = document.getElementById('cropConfirmBtn');
        const cancelBtn = document.getElementById('cropCancelBtn');
        const closeBtn = document.getElementById('closeCropModalBtn');

        if (!modal || !img) {
            reject(new Error('裁剪组件未初始化'));
            return;
        }

        ensureCropperLoaded().then(() => {
        const reader = new FileReader();
        reader.onload = (e) => {
            img.src = e.target.result;
            img.onload = () => {
                if (cropper) cropper.destroy();
                // 获取封面容器实际宽高比（用于锁定裁剪比例）
                const coverDiv = document.getElementById('profileCover');
                const containerWidth = coverDiv.clientWidth;
                const containerHeight = coverDiv.clientHeight;
                let aspectRatio = 16 / 6; // 默认 2.6667
                if (containerWidth && containerHeight) {
                    aspectRatio = containerWidth / containerHeight;
                }
                cropper = new Cropper(img, {
                    aspectRatio: aspectRatio,
                    viewMode: 1,
                    dragMode: 'move',
                    cropBoxMovable: true,
                    cropBoxResizable: true,
                    zoomable: true,
                    movable: true,
                    scalable: true,
                    zoomOnWheel: true,
                    zoomOnTouch: true,
                    background: false,
                    autoCropArea: 1,
                });
                modal.style.display = 'flex';
            };
        };
        reader.readAsDataURL(file);

        const onConfirm = () => {
            if (cropper) {
                // 高清输出：宽度 1920，高度按比例计算
                const canvas = cropper.getCroppedCanvas({
                    width: 1920,
                    height: 720,
                    imageSmoothingEnabled: true,
                    imageSmoothingQuality: 'high',
                });
                if (canvas) {
                    saveCoverFromCropped(canvas)
                        .then(() => {
                            showToast('封面已更新');
                            resolve();
                        })
                        .catch(reject);
                } else {
                    reject(new Error('裁剪失败'));
                }
            }
            cleanup();
            modal.style.display = 'none';
        };

        const cleanup = () => {
            if (cropper) {
                cropper.destroy();
                cropper = null;
            }
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            closeBtn.removeEventListener('click', onCancel);
        };

        const onCancel = () => {
            cleanup();
            modal.style.display = 'none';
            reject(new Error('用户取消裁剪'));
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        closeBtn.addEventListener('click', onCancel);
        }).catch(reject);
    });
}

function initCoverEditor() {
    const coverEditBtn = document.getElementById('coverEditBtn');
    const coverFileInput = document.getElementById('coverFileInput');
    if (!coverEditBtn || !coverFileInput) return;

    coverEditBtn.addEventListener('click', () => {
        coverFileInput.click();
    });

    coverFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            showToast('请选择图片文件（JPEG/PNG/WebP）');
            return;
        }
        if (file.size > 5 * 1024 * 1024) { // 放宽到 5MB，因为输出高清图可能稍大
            showToast('图片大小不能超过 5MB');
            return;
        }
        try {
            await openCropModal(file);
        } catch (err) {
            if (err.message !== '用户取消裁剪') {
                showToast(err.message || '裁剪失败，请重试');
            }
        }
        coverFileInput.value = '';
    });
}

// ========== 个人中心头部渲染 ==========
function renderProfileHeader() {
    const user = getUser();
    const email = user?.email || '';
    const username = user?.username || (email ? email.split('@')[0] : '同学');

    const usernameEl = document.getElementById('profileUsername');
    if (usernameEl) usernameEl.innerText = username;

    const emailLine = document.getElementById('profileEmailLine');
    if (emailLine) emailLine.innerHTML = email ? `<i class="fas fa-envelope" aria-hidden="true"></i> ${escapeHtml(email)}` : '';

    renderAvatar(user);
    loadAndRenderBio();

    const statusEl = document.getElementById('profileEmailVerified');
    const resendBtn = document.getElementById('sendVerifyEmailBtn');
    const verified = Boolean(user?.email_verified);
    if (statusEl) {
        statusEl.innerHTML = verified
            ? '<i class="fas fa-circle-check" aria-hidden="true"></i> 邮箱已验证'
            : '<i class="fas fa-circle-exclamation" aria-hidden="true"></i> 邮箱未验证';
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

async function loadAndRenderBio(force = false) {
    const bioEl = document.getElementById('profileBio');
    if (!bioEl) return;
    if (!force && _profileBioCache) {
        _applyProfileBio(_profileBioCache);
        return;
    }
    try {
        const profile = await getMyProfile();
        _profileBioCache = profile;
        _applyProfileBio(profile);
    } catch (e) {
        // 静默失败
    }
}

function _applyProfileBio(profile) {
    const bioEl = document.getElementById('profileBio');
    if (bioEl && profile.bio) bioEl.innerText = profile.bio;
    const campusEl = document.getElementById('profileCampus');
    if (campusEl) campusEl.innerHTML = profile.campus ? `<i class="fas fa-location-dot" aria-hidden="true"></i> ${escapeHtml(profile.campus)}校区` : '';

    const editUsername = document.getElementById('editUsername');
    const editBio = document.getElementById('editBio');
    const editTags = document.getElementById('editTags');
    const editCampus = document.getElementById('editCampus');
    if (editUsername) editUsername.value = profile.username || '';
    if (editBio) editBio.value = profile.bio || '';
    if (editTags) editTags.value = (profile.tags || []).join(', ');
    if (editCampus) editCampus.value = profile.campus || '';

    const tagsContainer = document.getElementById('profileTags');
    if (tagsContainer) {
        const tags = profile.tags || [];
        if (tags.length) {
            tagsContainer.innerHTML = tags.map(tag => `<span class="profile-tag-chip">${escapeHtml(tag)}</span>`).join('');
            tagsContainer.style.display = 'flex';
        } else {
            tagsContainer.innerHTML = '<span class="profile-tag-placeholder">暂无标签，去编辑资料添加～</span>';
            tagsContainer.style.display = 'flex';
        }
    }
}

// ========== Tab 切换 ==========
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
            default: container.innerHTML = '<div class="profile-empty-state">未知板块</div>';
        }
    } catch (e) {
        container.innerHTML = '<div class="profile-empty-state">加载失败，请稍后重试</div>';
    }
}

// ========== 我发布的组局 ==========
async function renderMyPosts(container) {
    const user = getUser();
    if (!user?.id) {
        container.innerHTML = '<div class="profile-empty-state"><i class="fas fa-file-lines"></i>请先登录</div>';
        return;
    }
    try {
        const data = await listPosts({ user_id: user.id, page_size: 50 });
        const posts = data.items || [];
        document.getElementById('postCount').innerText = posts.length;
        if (!posts.length) {
            container.innerHTML = `
                <div class="profile-empty-state">
                    <i class="fas fa-file-lines"></i>
                    <p>还没有发布过组局</p>
                    <button class="primary-btn small" id="gotoCreatePostBtn"><i class="fas fa-plus" aria-hidden="true"></i> 发起第一个组局</button>
                </div>`;
            const gotoBtn = document.getElementById('gotoCreatePostBtn');
            if (gotoBtn) gotoBtn.addEventListener('click', () => window.switchPage('partner'));
            return;
        }
        container.innerHTML = posts.map(p => `
            <article class="profile-content-card" data-post-id="${p.id}">
                <div class="profile-content-card-title">${escapeHtml(p.title || '无标题')}</div>
                <div class="profile-content-card-body">${escapeHtml((p.content || p.description || '').substring(0, 150))}</div>
                <div class="profile-content-card-meta">
                    <span><i class="fas fa-bookmark"></i> ${escapeHtml(p.category || p.type || '')}</span>
                    <span><i class="fas fa-clock"></i> ${formatDate(p.created_at)}</span>
                    <span><i class="fas fa-heart"></i> ${p.like_count || 0} 赞</span>
                    <span><i class="fas fa-comment"></i> ${p.comment_count || 0} 评</span>
                </div>
            </article>
        `).join('');
        container.querySelectorAll('.profile-content-card').forEach(card => {
            card.addEventListener('click', () => {
                const postId = parseInt(card.getAttribute('data-post-id'));
                if (postId && typeof window.openPostDetail === 'function') window.openPostDetail(postId);
            });
            card.style.cursor = 'pointer';
        });
        const totalLikes = posts.reduce((sum, p) => sum + (p.like_count || 0), 0);
        document.getElementById('likeReceivedCount').innerText = totalLikes;
    } catch (e) {
        container.innerHTML = '<div class="profile-empty-state">加载失败，请稍后重试</div>';
    }
}

// ========== 我的评论 ==========
async function renderMyComments(container) {
    try {
        const [reviewsData, postCommentsData] = await Promise.all([
            getReviews().catch(() => ({ items: [] })),
            getMyPostComments().catch(() => ({ items: [] })),
        ]);
        const reviews = reviewsData.items || [];
        const postComments = postCommentsData.items || [];

        const comments = [];
        postComments.forEach(c => {
            comments.push({
                type: 'post',
                content: c.content || '',
                postTitle: c.post_title || '未知帖子',
                postId: c.post_id,
                time: c.created_at,
            });
        });
        reviews.forEach(r => {
            comments.push({
                type: 'place',
                content: r.content || '',
                placeName: r.place?.name || '未知场所',
                time: r.created_at,
                rating: r.rating,
            });
        });
        comments.sort((a, b) => new Date(b.time) - new Date(a.time));

        document.getElementById('commentMadeCount').innerText = comments.length;
        if (!comments.length) {
            container.innerHTML = `
                <div class="profile-empty-state">
                    <i class="fas fa-comment"></i>
                    <p>还没有发表过评论</p>
                    <button class="primary-btn small" id="gotoCommentBtn"><i class="fas fa-utensils" aria-hidden="true"></i> 去评价一家店</button>
                </div>`;
            const gotoBtn = document.getElementById('gotoCommentBtn');
            if (gotoBtn) gotoBtn.addEventListener('click', () => window.switchPage('guide'));
            return;
        }
        container.innerHTML = comments.map(c => {
            if (c.type === 'post') {
                return `
                    <article class="profile-content-card" data-post-id="${c.postId}">
                        <div class="profile-content-card-title"><i class="fas fa-comment" aria-hidden="true"></i> 回复：${escapeHtml(c.postTitle)}</div>
                        <div class="profile-content-card-body">${escapeHtml(c.content)}</div>
                        <div class="profile-content-card-meta">
                            <span><i class="fas fa-clock"></i> ${formatDate(c.time)}</span>
                            <span class="profile-tag">帖子评论</span>
                        </div>
                    </article>`;
            }
            return `
                <article class="profile-content-card">
                    <div class="profile-content-card-title"><i class="fas fa-location-dot"></i> ${escapeHtml(c.placeName)}</div>
                    <div class="profile-content-card-body">${escapeHtml(c.content)}</div>
                    <div class="profile-content-card-meta">
                        <span><i class="fas fa-clock"></i> ${formatDate(c.time)}</span>
                        ${c.rating ? `<span><i class="fas fa-star"></i> ${c.rating} 分</span>` : ''}
                    </div>
                </article>`;
        }).join('');
        container.querySelectorAll('.profile-content-card[data-post-id]').forEach(card => {
            card.addEventListener('click', () => {
                const postId = parseInt(card.getAttribute('data-post-id'));
                if (postId && typeof window.openPostDetail === 'function') window.openPostDetail(postId);
            });
            card.style.cursor = 'pointer';
        });
    } catch (e) {
        container.innerHTML = '<div class="profile-empty-state">加载失败，请稍后重试</div>';
    }
}

// ========== 我的收藏 ==========
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
            container.innerHTML = `
                <div class="profile-empty-state">
                    <i class="fas fa-heart"></i>
                    <p>还没有收藏或点赞</p>
                    <button class="primary-btn small" id="gotoGuideBtn"><i class="fas fa-compass" aria-hidden="true"></i> 去发现宝藏店铺</button>
                </div>`;
            const gotoBtn = document.getElementById('gotoGuideBtn');
            if (gotoBtn) gotoBtn.addEventListener('click', () => window.switchPage('guide'));
            return;
        }
        container.innerHTML = items.map(item => `
            <article class="profile-content-card">
                <div class="profile-content-card-title">${escapeHtml(item.place?.name || '未知场所')}</div>
                <div class="profile-content-card-body">${item.place?.address ? escapeHtml(item.place.address) : ''}</div>
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

// ========== 我的活动 ==========
async function renderMyActivities(container) {
    try {
        const data = await listPosts({ page_size: 30 });
        const user = getUser();
        const allPosts = data.items || [];
        const myActivities = allPosts.filter(p =>
            (p.participants || []).some(part => part.user_id === user?.id || part.username === user?.username)
        );

        if (!myActivities.length) {
            container.innerHTML = `
                <div class="profile-empty-state">
                    <i class="fas fa-calendar"></i>
                    <p>还没有参加过组局活动</p>
                    <button class="primary-btn small" id="gotoPartnerBtn"><i class="fas fa-user-group" aria-hidden="true"></i> 去看看有哪些活动</button>
                </div>`;
            const gotoBtn = document.getElementById('gotoPartnerBtn');
            if (gotoBtn) gotoBtn.addEventListener('click', () => window.switchPage('partner'));
            return;
        }
        container.innerHTML = myActivities.map(p => `
            <article class="profile-content-card" data-post-id="${p.id}">
                <div class="profile-content-card-title">${escapeHtml(p.title || '无标题')}</div>
                <div class="profile-content-card-body">${escapeHtml((p.content || p.description || '').substring(0, 120))}</div>
                <div class="profile-content-card-meta">
                    <span><i class="fas fa-bookmark"></i> ${escapeHtml(p.category || p.type || '')}</span>
                    <span><i class="fas fa-clock"></i> ${formatDate(p.created_at)}</span>
                    <span><i class="fas fa-users"></i> ${p.participant_count || 0} 人参与</span>
                </div>
            </article>
        `).join('');
        container.querySelectorAll('.profile-content-card').forEach(card => {
            card.addEventListener('click', () => {
                const postId = parseInt(card.getAttribute('data-post-id'));
                if (postId && typeof window.openPostDetail === 'function') window.openPostDetail(postId);
            });
            card.style.cursor = 'pointer';
        });
    } catch (e) {
        container.innerHTML = '<div class="profile-empty-state">加载失败，请稍后重试</div>';
    }
}

// ========== 编辑个人资料 ==========
function initEditProfile() {
    const modal = document.getElementById('editProfileModal');
    const openBtn = document.getElementById('editProfileBtn');
    const closeBtn = document.getElementById('closeEditProfileBtn');
    const cancelBtn = document.getElementById('cancelEditProfileBtn');
    const form = document.getElementById('editProfileForm');
    const deleteBtn = document.getElementById('deleteAccountBtn');

    openBtn?.addEventListener('click', async () => {
        document.getElementById('editOldPassword').value = '';
        document.getElementById('editNewPassword').value = '';
        document.getElementById('deleteAccountPassword').value = '';
        try {
            const profile = await getMyProfile();
            document.getElementById('editUsername').value = profile.username || '';
            document.getElementById('editBio').value = profile.bio || '';
            document.getElementById('editTags').value = (profile.tags || []).join(', ');
            document.getElementById('editCampus').value = profile.campus || '';
        } catch (e) { /* 使用默认值 */ }
        modal.style.display = 'flex';
    });

    closeBtn?.addEventListener('click', () => { modal.style.display = 'none'; });
    cancelBtn?.addEventListener('click', () => { modal.style.display = 'none'; });
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
    });

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('editUsername').value.trim();
        const bio = document.getElementById('editBio').value.trim();
        const campus = document.getElementById('editCampus')?.value || '';
        const tagsStr = document.getElementById('editTags').value.trim();
        const tags = tagsStr ? tagsStr.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [];
        const oldPwd = document.getElementById('editOldPassword').value;
        const newPwd = document.getElementById('editNewPassword').value;

        const saveBtn = document.getElementById('saveProfileBtn');
        const originalText = saveBtn.innerText;
        saveBtn.disabled = true;
        saveBtn.innerText = '保存中...';
        try {
            await updateMyProfile({ username, bio, campus, tags });
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
            const user = getUser();
            if (user && campus !== undefined) {
                user.campus = campus;
                localStorage.setItem('current_user', JSON.stringify(user));
            }
            _profileBioCache = null;
            loadAndRenderBio(true);
        } catch (err) {
            showToast(err.message || '保存失败');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerText = originalText;
        }
    });

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

// ========== 对外刷新接口 ==========
export async function refreshProfile() {
    if (!isLoggedIn()) return;
    renderProfileHeader();
    loadProfileCover();
    loadProfileTabContent(currentProfileTab);
}

// ========== 初始化入口 ==========
export function initProfilePage() {
    initProfileTabs();
    initEditProfile();
    initCoverEditor();
    loadProfileCover();
    renderProfileHeader();

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
}