// ================================================================
// profile.js - 个人中心模块（含封面裁剪高清版）
// ================================================================

import { getFavorites, getLikes, getReviews, getMyPostComments, changePassword, deleteAccount, getMyProfile, updateMyProfile, listPosts, getUserProfile, sendFriendRequest, uploadAvatar, uploadCover } from '../api.js';
import { resendVerificationEmail, getUser, isLoggedIn, doLogout, updateUserFromLogin } from '../auth.js';
import { showToast, escapeHtml, formatDate, avatarStorageKey, resolveApiAssetUrl, getAvatarInitial, bumpAvatarVersion, renderAvatarInto } from '../utils.js';
import { t } from '../i18n.js';
import { BUBBLE_THEME_PRESETS, DEFAULT_BUBBLE_STYLE, normalizeBubbleStyle } from '../bubbleThemes.js';

let currentProfileTab = 'posts';
let _profileBioCache = null;
let _viewingUserId = null;
let _viewingProfileCache = null;
let _userCardModalInited = false;
let _userCardOpenUserId = null;
const VISITOR_HIDDEN_TABS = ['comments', 'favorites', 'activities'];

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

// 封面默认背景（纯 CSS 渐变，不依赖外网图床）
const COVER_GRADIENTS = [
    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    'linear-gradient(135deg, #6B21A5 0%, #EC4899 100%)',
    'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)',
    'linear-gradient(135deg, #10b981 0%, #3b82f6 100%)',
    'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
];

// 获取当前用户的封面存储 Key（用户隔离）
function getCoverStorageKey() {
    const user = getUser();
    if (!user || !user.id) return null;
    return `user_cover_${user.id}`;
}

// 裁剪前原图存储 Key（用于“点击查看原图/大图”）
function getCoverOriginalKey() {
    const user = getUser();
    if (!user || !user.id) return null;
    return `user_cover_orig_${user.id}`;
}
function getAvatarOriginalKey() {
    const user = getUser();
    if (!user || !user.id) return null;
    return `user_avatar_orig_${user.id}`;
}

// 将 dataURL 等比缩小到 maxDim 内，控制 localStorage 体积（用于保存原图）
function downscaleDataUrl(dataUrl, maxDim = 1600, quality = 0.86) {
    return new Promise((resolve) => {
        const im = new Image();
        im.onload = () => {
            const scale = Math.min(1, maxDim / Math.max(im.width, im.height));
            const w = Math.round(im.width * scale);
            const h = Math.round(im.height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(im, 0, 0, w, h);
            try {
                resolve(canvas.toDataURL('image/jpeg', quality));
            } catch (e) {
                resolve(dataUrl);
            }
        };
        im.onerror = () => resolve(dataUrl);
        im.src = dataUrl;
    });
}

// 容错写入 localStorage：原图超出配额时静默跳过（不影响裁剪结果保存）
function safeSetItem(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (e) {
        console.warn('保存原图失败（可能超出本地存储配额）:', e?.message);
        return false;
    }
}

// 裁剪弹窗的两种模式配置（头像 1:1 导出 320x320，足够清晰且体积可控）
const CROP_PRESETS = {
    cover: {
        aspect: 3 / 1,
        exportWidth: 1500,
        exportHeight: 500,
        title: '调整封面图片',
        hint: '拖拽或缩放图片，封面在所有设备上按 3:1 比例显示',
        successMsg: '封面已更新',
    },
    avatar: {
        aspect: 1,
        exportWidth: 320,
        exportHeight: 320,
        title: '调整头像',
        hint: '拖拽或缩放图片，上传后将保存到你的账号',
        successMsg: '头像已更新',
    },
};

function ensureBubbleStyleEditor() {
    const campusSelect = document.getElementById('editCampus');
    if (!campusSelect || document.getElementById('editBubbleStyle')) return;

    const label = document.createElement('label');
    label.setAttribute('for', 'editBubbleStyle');
    label.innerText = '聊天气泡主题';

    const select = document.createElement('select');
    select.id = 'editBubbleStyle';
    select.innerHTML = BUBBLE_THEME_PRESETS.map((item) => (
        `<option value="${item.id}">${item.name}</option>`
    )).join('');

    campusSelect.insertAdjacentElement('afterend', select);
    select.insertAdjacentElement('beforebegin', label);
}

// ========== 封面功能（高清裁剪） ==========
let cropper = null;

function _fallbackCoverByUserId(userId) {
    const n = Number(userId) || 0;
    return COVER_GRADIENTS[Math.abs(n) % COVER_GRADIENTS.length];
}

function _isCoverGradient(value) {
    return typeof value === 'string' && value.includes('gradient');
}

function _localCoverForUser(userId) {
    const me = getUser();
    if (!me || userId == null || String(me.id) !== String(userId)) return null;
    return _readLocalCoverDataUrl(getCoverStorageKey());
}

function _ensureCoverImg(coverDiv, imgClass = 'profile-cover-img') {
    let img = coverDiv.querySelector('img');
    if (!img) {
        img = document.createElement('img');
        if (imgClass) img.className = imgClass;
        img.alt = '';
        coverDiv.insertBefore(img, coverDiv.firstChild);
    } else if (imgClass) {
        img.className = imgClass;
    }
    return img;
}

function _applyCoverGradient(coverDiv, gradient) {
    const img = coverDiv.querySelector('img');
    if (img) {
        img.onerror = null;
        img.onload = null;
        img.removeAttribute('src');
        img.style.display = 'none';
    }
    coverDiv.style.backgroundImage = gradient;
    coverDiv.style.backgroundSize = 'cover';
    coverDiv.style.backgroundPosition = 'center';
    coverDiv.dataset.coverSrc = '';
}

function applyCoverToElement(coverEl, coverUrl, { userId = null, cacheBust = false, fallback = null, imgClass = 'profile-cover-img' } = {}) {
    if (!coverEl) return;
    const uid = userId ?? getUser()?.id;
    const gradientFallback = fallback || _fallbackCoverByUserId(uid);
    const candidates = _buildCoverCandidates(coverUrl, uid, {
        cacheBust: cacheBust || Boolean(coverUrl && String(coverUrl).includes('/users/')),
    });

    if (!candidates.length) {
        _applyCoverGradient(coverEl, gradientFallback);
        return;
    }

    const img = _ensureCoverImg(coverEl, imgClass);
    coverEl.style.backgroundImage = 'none';

    let attempt = 0;
    img.style.display = 'block';
    img.onload = () => {
        img.style.display = 'block';
        coverEl.dataset.coverSrc = img.currentSrc || img.src;
    };
    img.onerror = () => {
        attempt += 1;
        if (attempt < candidates.length) {
            img.src = candidates[attempt];
        } else {
            _applyCoverGradient(coverEl, gradientFallback);
        }
    };

    attempt = 0;
    img.src = candidates[0];
}

function setProfileCover(coverUrl, fallback = null, { userId = null, cacheBust = false } = {}) {
    applyCoverToElement(document.getElementById('profileCover'), coverUrl, {
        userId,
        cacheBust,
        fallback,
        imgClass: 'profile-cover-img',
    });
}

function resolveCoverUrl(raw, { cacheBust = false } = {}) {
    if (!raw || typeof raw !== 'string') return '';
    if (_isCoverGradient(raw)) return raw;
    return resolveApiAssetUrl(raw, { cacheBust });
}

function _legacyCoverCandidates(userId) {
    if (userId == null) return [];
    const id = Number(userId);
    if (!Number.isFinite(id) || id <= 0) return [];
    return ['jpg', 'jpeg', 'png', 'webp'].map(
        (ext) => resolveApiAssetUrl(`/api/social/covers/user_${id}.${ext}`),
    );
}

function _buildCoverCandidates(coverUrl, userId, { cacheBust = false } = {}) {
    const candidates = [];
    const add = (url) => {
        if (!url || _isCoverGradient(url)) return;
        if (!candidates.includes(url)) candidates.push(url);
    };

    const local = _localCoverForUser(userId);

    const primary = resolveCoverUrl(coverUrl, { cacheBust });
    add(primary);

    for (const legacy of _legacyCoverCandidates(userId)) add(legacy);

    if (local?.startsWith('data:')) add(local);
    if (local && !local.startsWith('data:')) add(local);

    return candidates;
}

function _readLocalCoverDataUrl(storageKey) {
    if (!storageKey) return null;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    if (_isCoverGradient(raw) || /^https?:\/\//i.test(raw)) {
        localStorage.removeItem(storageKey);
        return null;
    }
    return raw.startsWith('data:') ? raw : null;
}

function loadProfileCover(targetUser = null) {
    const user = targetUser || getUser();
    if (!user) return;
    const fallback = _fallbackCoverByUserId(user.id);
    const opts = { userId: user.id };
    const isSelf = !targetUser || (getUser() && String(getUser().id) === String(user.id));
    const storageKey = isSelf ? getCoverStorageKey() : null;
    const localCover = _readLocalCoverDataUrl(storageKey);

    if (user.cover_url) {
        setProfileCover(user.cover_url, fallback, opts);
        return;
    }

    if (localCover?.startsWith('data:')) {
        setProfileCover(localCover, fallback, opts);
        return;
    }

    setProfileCover('', fallback, opts);
}

// ========== 头像（与封面相同的加载 / 上传 / 回退逻辑） ==========
function _localAvatarForUser(userId) {
    const me = getUser();
    if (!me || userId == null || String(me.id) !== String(userId)) return null;
    return _readLocalAvatarDataUrl(avatarStorageKey(me));
}

function _readLocalAvatarDataUrl(storageKey) {
    if (!storageKey) return null;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) {
        localStorage.removeItem(storageKey);
        return null;
    }
    return raw.startsWith('data:') ? raw : null;
}

function resolveAvatarDisplayUrl(raw, { cacheBust = false } = {}) {
    if (!raw || typeof raw !== 'string') return '';
    if (raw.startsWith('data:')) return raw;
    return resolveApiAssetUrl(raw, { cacheBust });
}

function _buildAvatarCandidates(avatarUrl, userId, { cacheBust = false } = {}) {
    const candidates = [];
    const add = (url) => {
        if (!url) return;
        if (!candidates.includes(url)) candidates.push(url);
    };

    const primary = resolveAvatarDisplayUrl(avatarUrl, {
        cacheBust: cacheBust || Boolean(avatarUrl && String(avatarUrl).includes('/users/')),
    });
    add(primary);

    const local = _localAvatarForUser(userId);
    if (local?.startsWith('data:')) add(local);
    if (local && !local.startsWith('data:')) add(local);

    return candidates;
}

function _applyAvatarToElement(el, candidates, user, fontSize = '2rem') {
    if (!el) return;
    const init = getAvatarInitial(user);

    const showInitial = () => {
        el.style.position = '';
        el.style.background = init.bg;
        el.innerHTML = `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:${fontSize};font-weight:800;color:#fff;background:${init.bg};border-radius:inherit;">${escapeHtml(init.initial)}</span>`;
    };

    if (!candidates.length) {
        showInitial();
        return;
    }

    let idx = 0;
    const tryLoad = () => {
        const src = candidates[idx];
        el.style.position = 'relative';
        el.style.background = init.bg;
        el.innerHTML = `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:${fontSize};font-weight:800;color:#fff;border-radius:inherit;">${escapeHtml(init.initial)}</span>`;
        const img = document.createElement('img');
        img.alt = '头像';
        img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;';
        if (user?.id != null) img.dataset.userId = String(user.id);
        img.onerror = () => {
            idx += 1;
            if (idx < candidates.length) tryLoad();
            else showInitial();
        };
        img.src = src;
        el.appendChild(img);
    };
    tryLoad();
}

function setProfileAvatar(avatarUrl, { userId = null, username = '', cacheBust = false } = {}) {
    const uid = userId ?? getUser()?.id;
    const user = { id: uid, username: username || getUser()?.username || '' };
    const candidates = _buildAvatarCandidates(avatarUrl, uid, {
        cacheBust: cacheBust || Boolean(avatarUrl && String(avatarUrl).includes('/users/')),
    });
    _applyAvatarToElement(document.getElementById('profileAvatarLarge'), candidates, user, '2rem');
    _applyAvatarToElement(document.getElementById('editAvatarPreview'), candidates, user, '2rem');
}

function loadProfileAvatar(targetUser = null) {
    const user = targetUser || getUser();
    if (!user) return;
    const opts = { userId: user.id, username: user.username || '' };
    const isSelf = !targetUser || (getUser() && String(getUser().id) === String(user.id));
    const storageKey = isSelf ? avatarStorageKey(getUser()) : null;
    const localAvatar = _readLocalAvatarDataUrl(storageKey);

    if (user.avatar_url) {
        setProfileAvatar(user.avatar_url, opts);
        return;
    }

    if (localAvatar?.startsWith('data:')) {
        setProfileAvatar(localAvatar, opts);
        return;
    }

    setProfileAvatar('', opts);
}

async function saveCoverFromCropped(canvas, originalDataUrl) {
    const user = getUser();
    if (!user) throw new Error('请先登录');
    const storageKey = getCoverStorageKey();
    const base64 = canvas.toDataURL('image/jpeg', 0.88);
    const fallback = _fallbackCoverByUserId(user.id);
    const origKey = getCoverOriginalKey();
    if (origKey && originalDataUrl) {
        safeSetItem(origKey, await downscaleDataUrl(originalDataUrl, 1920, 0.86));
    }
    if (storageKey) localStorage.setItem(storageKey, base64);
    setProfileCover(base64, fallback, { userId: user.id });
    try {
        const res = await uploadCover(base64);
        if (res?.cover_url) {
            updateUserFromLogin({ ...getUser(), cover_url: res.cover_url });
            setProfileCover(res.cover_url, fallback, { userId: user.id, cacheBust: true });
            return;
        }
        throw new Error('服务器未返回封面地址');
    } catch (e) {
        console.warn('封面上传服务端失败，已保存本地:', e?.message);
        updateUserFromLogin({ ...getUser(), cover_url: '' });
        showToast(t('profile.coverLocalOnly'));
    }
}

async function saveAvatarFromCropped(canvas, originalDataUrl) {
    const user = getUser();
    if (!user) throw new Error('请先登录');
    const storageKey = avatarStorageKey(user);
    const base64 = canvas.toDataURL('image/jpeg', 0.88);
    const origKey = getAvatarOriginalKey();
    if (origKey && originalDataUrl) {
        safeSetItem(origKey, await downscaleDataUrl(originalDataUrl, 1280, 0.88));
    }
    if (storageKey) localStorage.setItem(storageKey, base64);
    setProfileAvatar(base64, { userId: user.id, username: user.username || '' });
    if (typeof window.updateNavBar === 'function') window.updateNavBar();
    try {
        const res = await uploadAvatar(base64);
        if (res?.avatar_url) {
            updateUserFromLogin({ ...getUser(), avatar_url: res.avatar_url });
            bumpAvatarVersion(user.id);
            setProfileAvatar(res.avatar_url, { userId: user.id, username: user.username || '', cacheBust: true });
            if (typeof window.updateNavBar === 'function') window.updateNavBar();
            return;
        }
        throw new Error('服务器未返回头像地址');
    } catch (e) {
        console.warn('头像上传服务端失败，已保存本地:', e?.message);
        showToast(t('profile.avatarLocalOnly'));
        setProfileAvatar(base64, { userId: user.id, username: user.username || '' });
        if (typeof window.updateNavBar === 'function') window.updateNavBar();
    }
}

const CROP_SAVERS = {
    cover: saveCoverFromCropped,
    avatar: saveAvatarFromCropped,
};

// 移动端视口（与 profile.css 封面断点保持一致）
function isMobileViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
}

// 封面在移动端按 2:1 裁剪，网页端按 3:1
function resolveCropPreset(mode) {
    const base = CROP_PRESETS[mode] || CROP_PRESETS.cover;
    if (mode === 'cover' && isMobileViewport()) {
        return {
            ...base,
            aspect: 2 / 1,
            exportWidth: 1200,
            exportHeight: 600,
            hint: '拖拽或缩放图片，移动端封面按 2:1 比例显示',
        };
    }
    return base;
}

/**
 * 打开裁剪弹窗。mode 为 'cover' 或 'avatar'，决定比例、导出尺寸与保存目标。
 */
function openCropModal(file, mode = 'cover') {
    return new Promise((resolve, reject) => {
        const preset = resolveCropPreset(mode);
        const modal = document.getElementById('cropModal');
        const img = document.getElementById('cropImage');
        const confirmBtn = document.getElementById('cropConfirmBtn');
        const cancelBtn = document.getElementById('cropCancelBtn');
        const closeBtn = document.getElementById('closeCropModalBtn');
        const titleEl = document.getElementById('cropModalTitle');
        const hintEl = document.getElementById('cropModalHint');

        if (!modal || !img) {
            reject(new Error('裁剪组件未初始化'));
            return;
        }

        if (titleEl) titleEl.innerText = preset.title;
        if (hintEl) hintEl.innerText = preset.hint;
        // 头像裁剪框显示为圆形，体验更贴合最终展示
        modal.classList.toggle('crop-avatar-mode', mode === 'avatar');

        let originalDataUrl = null;
        ensureCropperLoaded().then(() => {
        const reader = new FileReader();
        reader.onload = (e) => {
            originalDataUrl = e.target.result;
            img.src = e.target.result;
            img.onload = () => {
                if (cropper) cropper.destroy();
                cropper = new Cropper(img, {
                    aspectRatio: preset.aspect,
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

        const onConfirm = async () => {
            if (!cropper) return;
            const canvas = cropper.getCroppedCanvas({
                width: preset.exportWidth,
                height: preset.exportHeight,
                imageSmoothingEnabled: true,
                imageSmoothingQuality: 'high',
            });
            if (!canvas) {
                cleanup();
                modal.style.display = 'none';
                reject(new Error('裁剪失败'));
                return;
            }
            try {
                await (CROP_SAVERS[mode] || saveCoverFromCropped)(canvas, originalDataUrl);
                showToast(preset.successMsg);
                resolve();
            } catch (err) {
                reject(err);
            } finally {
                cleanup();
                modal.style.display = 'none';
            }
        };

        const cleanup = () => {
            if (cropper) {
                cropper.destroy();
                cropper = null;
            }
            modal.classList.remove('crop-avatar-mode');
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
    if (!coverEditBtn || !coverFileInput || coverFileInput.dataset.bound === 'true') return;
    coverFileInput.dataset.bound = 'true';

    coverEditBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        coverFileInput.click();
    });
    // 隐藏 input 位于封面内，其 .click() 触发的事件会冒泡到封面 → 误触“查看大图”，在此拦截
    coverFileInput.addEventListener('click', (e) => e.stopPropagation());

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
            await openCropModal(file, 'cover');
        } catch (err) {
            if (err.message !== '用户取消裁剪') {
                showToast(err.message || '裁剪失败，请重试');
            }
        }
        coverFileInput.value = '';
    });
}

// ========== 个人中心头部渲染 ==========
function isViewingSelf() {
    const me = getUser();
    return !_viewingUserId || (me && String(me.id) === String(_viewingUserId));
}

function isRestrictedTabForVisitor(tabId) {
    return ['friends', 'comments', 'favorites', 'activities'].includes(tabId);
}

function applyProfileModeUI(isSelf) {
    const editBtn = document.getElementById('editProfileBtn');
    const coverEdit = document.getElementById('coverEditBtn');
    const emailLine = document.getElementById('profileEmailLine');
    const statusRow = document.querySelector('.profile-status-row');
    const socialActions = document.getElementById('profileSocialActions');
    if (editBtn) editBtn.style.display = isSelf ? '' : 'none';
    if (coverEdit) coverEdit.style.display = isSelf ? '' : 'none';
    if (emailLine) emailLine.style.display = isSelf ? '' : 'none';
    if (statusRow) statusRow.style.display = isSelf ? '' : 'none';
    if (socialActions) socialActions.style.display = isSelf ? 'none' : 'flex';
    document.querySelectorAll('.profile-stat-self').forEach((el) => {
        el.style.display = isSelf ? '' : 'none';
    });
    const friendStat = document.querySelector('.profile-stat-friends');
    if (friendStat) {
        friendStat.disabled = !isSelf;
        friendStat.classList.toggle('is-disabled', !isSelf);
        friendStat.title = isSelf ? '查看好友' : '他人主页不支持查看好友';
    }
    document.querySelectorAll('.profile-tab').forEach((tab) => {
        const id = tab.getAttribute('data-profile-tab');
        if (VISITOR_HIDDEN_TABS.includes(id)) {
            tab.hidden = !isSelf;
            tab.style.display = isSelf ? '' : 'none';
            tab.setAttribute('aria-hidden', isSelf ? 'false' : 'true');
        }
        if (id === 'posts') {
            tab.innerHTML = isSelf
                ? '<i class="fas fa-file-lines"></i> 我发布的'
                : '<i class="fas fa-file-lines"></i> TA 的帖子';
        }
    });
    const cover = document.getElementById('profileCover');
    if (cover) cover.style.cursor = isSelf ? 'pointer' : 'default';
}

async function renderSocialActions(profile) {
    const box = document.getElementById('profileSocialActions');
    if (!box || isViewingSelf()) return;
    _bindSocialActions(profile, box, {
        onRefresh: async () => {
            _viewingProfileCache = null;
            await renderProfileHeader();
        },
    });
}

function _buildSocialActionsHtml(profile) {
    const status = profile.friendship_status || 'none';
    if (status === 'none') {
        return `<button class="profile-social-btn primary js-user-social-add" type="button"><i class="fas fa-user-plus"></i> 加好友</button>`;
    }
    if (status === 'pending_sent') {
        return `<button class="profile-social-btn" disabled type="button">已发送请求</button>`;
    }
    if (status === 'pending_received') {
        return `<button class="profile-social-btn" disabled type="button">对方已请求加你</button>`;
    }
    if (status === 'friends') {
        return `<button class="profile-social-btn primary js-user-social-dm" type="button"><i class="fas fa-comment"></i> 发消息</button>`;
    }
    return '';
}

function _bindSocialActions(profile, container, { onRefresh, closeCardOnDm = false } = {}) {
    if (!container) return;
    container.innerHTML = _buildSocialActionsHtml(profile);
    container.querySelector('.js-user-social-add')?.addEventListener('click', async () => {
        try {
            await sendFriendRequest(profile.id);
            showToast('好友请求已发送');
            if (onRefresh) await onRefresh();
        } catch (e) {
            showToast(e.message);
        }
    });
    container.querySelector('.js-user-social-dm')?.addEventListener('click', () => {
        if (closeCardOnDm) closeUserCardModal();
        if (window.openChatWith) window.openChatWith(profile.id);
        else window.switchPage('messages');
    });
}

function _applyUserCardCover(coverEl, profile) {
    if (!coverEl || !profile) return;
    applyCoverToElement(coverEl, profile.cover_url, {
        userId: profile.id,
        fallback: _fallbackCoverByUserId(profile.id),
        imgClass: '',
    });
}

function _renderUserCardContent(profile) {
    const nameEl = document.getElementById('userCardName');
    const campusEl = document.getElementById('userCardCampus');
    const bioEl = document.getElementById('userCardBio');
    const tagsEl = document.getElementById('userCardTags');
    const avatarEl = document.getElementById('userCardAvatar');
    const coverEl = document.getElementById('userCardCover');
    const actionsEl = document.getElementById('userCardActions');

    if (nameEl) nameEl.textContent = profile.username || '用户';
    if (campusEl) {
        campusEl.innerHTML = profile.campus
            ? `<i class="fas fa-location-dot" aria-hidden="true"></i> ${escapeHtml(profile.campus)}校区`
            : '';
    }
    if (bioEl) {
        bioEl.textContent = profile.bio || '这个人很懒，什么都没写...';
    }
    if (tagsEl) {
        const tags = profile.tags || [];
        tagsEl.innerHTML = tags.length
            ? tags.map((tag) => `<span class="user-card-tag">${escapeHtml(tag)}</span>`).join('')
            : '';
    }
    document.getElementById('userCardPostCount').textContent = profile.post_count ?? 0;
    document.getElementById('userCardFriendCount').textContent = profile.friend_count ?? 0;
    document.getElementById('userCardLikeCount').textContent = profile.like_received_count ?? 0;

    if (avatarEl) renderAvatarInto(avatarEl, profile, '1.5rem');
    _applyUserCardCover(coverEl, profile);

    const cardActionsEl = actionsEl;
    if (cardActionsEl) {
        const status = profile.friendship_status || 'none';
        let html = '';
        if (status === 'none') {
            html = `<button class="user-card-action-btn primary js-user-card-add" type="button"><i class="fas fa-user-plus"></i> 加好友</button>`;
        } else if (status === 'pending_sent') {
            html = `<button class="user-card-action-btn" disabled type="button">已发送请求</button>`;
        } else if (status === 'pending_received') {
            html = `<button class="user-card-action-btn" disabled type="button">对方已请求加你</button>`;
        } else if (status === 'friends') {
            html = `<button class="user-card-action-btn primary js-user-card-dm" type="button"><i class="fas fa-comment"></i> 发消息</button>`;
        }
        cardActionsEl.innerHTML = html;
        cardActionsEl.querySelector('.js-user-card-add')?.addEventListener('click', async () => {
            try {
                await sendFriendRequest(profile.id);
                showToast('好友请求已发送');
                const refreshed = await getUserProfile(profile.id);
                if (_userCardOpenUserId === profile.id) _renderUserCardContent(refreshed);
            } catch (e) {
                showToast(e.message);
            }
        });
        cardActionsEl.querySelector('.js-user-card-dm')?.addEventListener('click', () => {
            closeUserCardModal();
            if (window.openChatWith) window.openChatWith(profile.id);
            else window.switchPage('messages');
        });
    }
}

function closeUserCardModal() {
    const modal = document.getElementById('userCardModal');
    if (modal) modal.style.display = 'none';
    _userCardOpenUserId = null;
    document.getElementById('userCardBody')?.classList.remove('is-loading');
    document.querySelector('.user-card-modal')?.classList.remove('is-loading');
}

function initUserCardModal() {
    if (_userCardModalInited) return;
    _userCardModalInited = true;
    const modal = document.getElementById('userCardModal');
    if (!modal) return;
    document.getElementById('closeUserCardBtn')?.addEventListener('click', closeUserCardModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeUserCardModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') closeUserCardModal();
    });
}

export async function showUserCardModal(userId) {
    if (!isLoggedIn()) {
        const authModal = document.getElementById('authModal');
        if (authModal) authModal.style.display = 'flex';
        return;
    }
    initUserCardModal();
    const modal = document.getElementById('userCardModal');
    const card = modal?.querySelector('.user-card-modal');
    const body = document.getElementById('userCardBody');
    if (!modal || !card) return;

    _userCardOpenUserId = userId;
    modal.style.display = 'flex';
    card.classList.add('is-loading');
    body?.classList.add('is-loading');

    try {
        const profile = await getUserProfile(userId);
        if (_userCardOpenUserId !== userId) return;
        _renderUserCardContent(profile);
    } catch (e) {
        showToast('无法加载用户资料');
        closeUserCardModal();
    } finally {
        card.classList.remove('is-loading');
        body?.classList.remove('is-loading');
    }
}

async function renderProfileHeader() {
    const isSelf = isViewingSelf();
    applyProfileModeUI(isSelf);

    if (!isSelf && _viewingUserId) {
        try {
            const profile = _viewingProfileCache || await getUserProfile(_viewingUserId);
            _viewingProfileCache = profile;
            document.getElementById('profileUsername').innerText = profile.username || '用户';
            setProfileAvatar(profile.avatar_url || '', { userId: profile.id, username: profile.username || '' });
            loadProfileCover(profile);
            _applyProfileBio(profile);
            document.getElementById('postCount').innerText = profile.post_count ?? 0;
            document.getElementById('friendCount').innerText = profile.friend_count ?? 0;
            document.getElementById('likeReceivedCount').innerText = profile.like_received_count ?? 0;
            await renderSocialActions(profile);
        } catch (e) {
            showToast('无法加载用户资料');
        }
        return;
    }

    const user = getUser();
    const email = user?.email || '';
    const username = user?.username || (email ? email.split('@')[0] : '同学');

    const usernameEl = document.getElementById('profileUsername');
    if (usernameEl) usernameEl.innerText = username;

    const emailLine = document.getElementById('profileEmailLine');
    if (emailLine) emailLine.innerHTML = email ? `<i class="fas fa-envelope" aria-hidden="true"></i> ${escapeHtml(email)}` : '';

    renderAvatar(user);
    loadProfileCover(user);

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

    try {
        const profile = await getMyProfile();
        _profileBioCache = profile;
        _applyProfileBio(profile);
        document.getElementById('friendCount').innerText = profile.friend_count ?? 0;
        if (profile.avatar_url || profile.cover_url) {
            const nextUser = {
                ...user,
                avatar_url: profile.avatar_url || user.avatar_url || '',
                cover_url: profile.cover_url || user.cover_url || '',
            };
            updateUserFromLogin(nextUser);
            loadProfileAvatar(nextUser);
            loadProfileCover(nextUser);
        }
    } catch (e) { /* 静默 */ }
}

function renderAvatar(user) {
    loadProfileAvatar(user);
}

// ========== 图片查看灯箱（头像原图 / 背景大图） ==========
function openImageViewer(src, { circle = false } = {}) {
    if (!src) return;
    const overlay = document.createElement('div');
    overlay.className = 'img-viewer-overlay' + (circle ? ' is-avatar' : '');
    overlay.innerHTML = `
        <button class="img-viewer-close" type="button" aria-label="关闭"><i class="fas fa-times"></i></button>
        <img src="${src}" alt="查看大图">
    `;
    const close = () => overlay.remove();
    overlay.addEventListener('click', close);
    overlay.querySelector('img')?.addEventListener('click', (e) => e.stopPropagation());
    overlay.querySelector('.img-viewer-close')?.addEventListener('click', close);
    document.addEventListener('keydown', function onEsc(e) {
        if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
    });
    document.body.appendChild(overlay);
}

// ========== 头像上传与裁剪（与封面相同：先本地预览，再同步服务器） ==========
// 上传入口位于「编辑资料」弹窗内的头像预览；个人页大头像点击仅用于查看原图。
function initAvatarEditor() {
    const fileInput = document.getElementById('avatarFileInput');
    if (!fileInput) return;

    // 编辑资料弹窗内：点击头像预览 → 选图并裁剪
    document.getElementById('editAvatarPreview')?.addEventListener('click', () => {
        if (!isLoggedIn()) {
            showToast('请先登录');
            return;
        }
        fileInput.click();
    });

    // 个人页大头像：点击查看裁剪前原图（无原图时回退到当前头像）
    document.getElementById('profileAvatarLarge')?.addEventListener('click', () => {
        const origKey = getAvatarOriginalKey();
        const src = (origKey && localStorage.getItem(origKey))
            || (avatarStorageKey(getUser()) && localStorage.getItem(avatarStorageKey(getUser())));
        if (src) {
            openImageViewer(src, { circle: false });
        } else {
            showToast('还没有上传头像，可在「编辑资料」中设置');
        }
    });

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            showToast('请选择图片文件（JPEG/PNG/WebP）');
            fileInput.value = '';
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            showToast('图片大小不能超过 5MB');
            fileInput.value = '';
            return;
        }
        try {
            await openCropModal(file, 'avatar');
        } catch (err) {
            if (err.message !== '用户取消裁剪') {
                showToast(err.message || '裁剪失败，请重试');
            }
        }
        fileInput.value = '';
    });
}

// 点击封面背景查看大图（点击右下角“更换封面”按钮不触发）
function initCoverViewer() {
    const cover = document.getElementById('profileCover');
    if (!cover) return;
    cover.addEventListener('click', (e) => {
        if (e.target.closest('#coverEditBtn') || e.target.id === 'coverFileInput') return;
        const origKey = getCoverOriginalKey();
        const src = cover.dataset.coverSrc
            || (origKey && localStorage.getItem(origKey))
            || (getCoverStorageKey() && localStorage.getItem(getCoverStorageKey()));
        if (src) openImageViewer(src, { circle: false });
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

function _fillEditProfileForm(profile) {
    const editUsername = document.getElementById('editUsername');
    const editBio = document.getElementById('editBio');
    const editTags = document.getElementById('editTags');
    const editCampus = document.getElementById('editCampus');
    const editBubbleStyle = document.getElementById('editBubbleStyle');
    if (editUsername) editUsername.value = profile.username || '';
    if (editBio) editBio.value = profile.bio || '';
    if (editTags) editTags.value = (profile.tags || []).join(', ');
    if (editCampus) editCampus.value = profile.campus || '';
    if (editBubbleStyle) {
        editBubbleStyle.value = normalizeBubbleStyle(profile.bubble_style || DEFAULT_BUBBLE_STYLE);
    }
}

function _clearEditProfileForm() {
    [
        'editUsername', 'editBio', 'editTags', 'editCampus',
        'editOldPassword', 'editNewPassword', 'deleteAccountPassword',
    ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const bubbleSelect = document.getElementById('editBubbleStyle');
    if (bubbleSelect) bubbleSelect.value = DEFAULT_BUBBLE_STYLE;
    _setEditProfileFormEnabled(false);
}

function _setEditProfileFormEnabled(enabled) {
    [
        'editUsername', 'editBio', 'editTags', 'editCampus',
        'editOldPassword', 'editNewPassword', 'deleteAccountPassword', 'editBubbleStyle',
    ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = !enabled;
    });
}

function _applyProfileBio(profile) {
    const bioEl = document.getElementById('profileBio');
    if (bioEl) bioEl.innerText = profile.bio || '这个人很懒，什么都没写...';
    const campusEl = document.getElementById('profileCampus');
    if (campusEl) campusEl.innerHTML = profile.campus ? `<i class="fas fa-location-dot" aria-hidden="true"></i> ${escapeHtml(profile.campus)}校区` : '';

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

function syncProfileTabUI(tabId) {
    document.querySelectorAll('.profile-tab').forEach(t => {
        t.classList.toggle('active', t.getAttribute('data-profile-tab') === tabId);
    });
    document.querySelectorAll('.profile-stat-item[data-profile-tab]').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-profile-tab') === tabId);
    });
}

function switchProfileTab(tabId) {
    if (!tabId) return;
    if (!isViewingSelf() && isRestrictedTabForVisitor(tabId)) {
        return;
    }
    // 「好友」是跳转消息页的入口，不是个人中心内的 Tab，勿写入 currentProfileTab
    if (tabId === 'friends') {
        if (typeof window.openMessagesTab === 'function') {
            window.openMessagesTab('friends');
        } else if (typeof window.switchPage === 'function') {
            window.switchPage('messages');
        }
        return;
    }
    currentProfileTab = tabId;
    syncProfileTabUI(tabId);
    loadProfileTabContent(tabId);
}

function initProfileStatJump() {
    document.querySelectorAll('.profile-stat-item[data-profile-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            const tabId = btn.getAttribute('data-profile-tab');
            if (tabId) switchProfileTab(tabId);
        });
    });
}

async function loadProfileTabContent(tabId) {
    const container = document.getElementById('profileTabContent');
    if (!container) return;
    if (!isViewingSelf() && isRestrictedTabForVisitor(tabId)) {
        tabId = 'posts';
        currentProfileTab = 'posts';
        syncProfileTabUI('posts');
    }
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
    const userId = isViewingSelf() ? getUser()?.id : _viewingUserId;
    if (!userId) {
        container.innerHTML = '<div class="profile-empty-state"><i class="fas fa-file-lines"></i>请先登录</div>';
        return;
    }
    try {
        const data = await listPosts({ user_id: userId, page_size: 50 });
        const posts = data.items || [];
        if (isViewingSelf()) document.getElementById('postCount').innerText = posts.length;
        if (!posts.length) {
            container.innerHTML = `
                <div class="profile-empty-state">
                    <i class="fas fa-file-lines"></i>
                    <p>${isViewingSelf() ? '还没有发布过组局' : 'TA 还没有发布过组局'}</p>
                    ${isViewingSelf() ? '<button class="primary-btn small" id="gotoCreatePostBtn"><i class="fas fa-plus" aria-hidden="true"></i> 发起第一个组局</button>' : ''}
                </div>`;
            document.getElementById('gotoCreatePostBtn')?.addEventListener('click', () => window.switchPage('partner'));
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
        if (isViewingSelf()) document.getElementById('likeReceivedCount').innerText = totalLikes;
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
            ...(favData.items || []).map(i => ({ ...i, favType: (i.kind === 'post' || i.post) ? '帖子收藏' : '收藏' })),
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
        container.innerHTML = items.map(item => {
            if (item.post) {
                return `
                    <article class="profile-content-card" data-post-id="${item.post.id}">
                        <div class="profile-content-card-title">${escapeHtml(item.post.title || '无标题帖子')}</div>
                        <div class="profile-content-card-body">${escapeHtml((item.post.content || '').substring(0, 120))}</div>
                        <div class="profile-content-card-meta">
                            <span class="profile-tag">${item.favType}</span>
                            <span><i class="fas fa-star"></i> ${item.post.favorite_count || 0}</span>
                            <span><i class="fas fa-clock"></i> ${formatDate(item.created_at)}</span>
                        </div>
                    </article>
                `;
            }
            return `
                <article class="profile-content-card">
                    <div class="profile-content-card-title">${escapeHtml(item.place?.name || '未知场所')}</div>
                    <div class="profile-content-card-body">${item.place?.address ? escapeHtml(item.place.address) : ''}</div>
                    <div class="profile-content-card-meta">
                        <span class="profile-tag">${item.favType}</span>
                        <span><i class="fas fa-clock"></i> ${formatDate(item.created_at)}</span>
                    </div>
                </article>
            `;
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
    _clearEditProfileForm();
    const modal = document.getElementById('editProfileModal');
    const openBtn = document.getElementById('editProfileBtn');
    const closeBtn = document.getElementById('closeEditProfileBtn');
    const cancelBtn = document.getElementById('cancelEditProfileBtn');
    const form = document.getElementById('editProfileForm');
    const deleteBtn = document.getElementById('deleteAccountBtn');

    openBtn?.addEventListener('click', async () => {
        _clearEditProfileForm();
        _setEditProfileFormEnabled(true);
        try {
            const profile = _profileBioCache || await getMyProfile();
            if (!_profileBioCache) _profileBioCache = profile;
            _fillEditProfileForm(profile);
        } catch (e) { /* 使用空表单 */ }
        modal.style.display = 'flex';
    });

    const closeEditModal = () => {
        modal.style.display = 'none';
        _clearEditProfileForm();
    };

    closeBtn?.addEventListener('click', closeEditModal);
    cancelBtn?.addEventListener('click', closeEditModal);
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) closeEditModal();
    });

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('editUsername').value.trim();
        const bio = document.getElementById('editBio').value.trim();
        const campus = document.getElementById('editCampus')?.value || '';
        const bubbleStyle = normalizeBubbleStyle(document.getElementById('editBubbleStyle')?.value || DEFAULT_BUBBLE_STYLE);
        const tagsStr = document.getElementById('editTags').value.trim();
        const tags = tagsStr ? tagsStr.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [];
        const oldPwd = document.getElementById('editOldPassword').value;
        const newPwd = document.getElementById('editNewPassword').value;

        const saveBtn = document.getElementById('saveProfileBtn');
        const originalText = saveBtn.innerText;
        saveBtn.disabled = true;
        saveBtn.innerText = '保存中...';
        try {
            const profile = await updateMyProfile({ username, bio, campus, tags, bubble_style: bubbleStyle });
            if (newPwd) {
                if (!oldPwd) { showToast('请输入当前密码以修改密码'); saveBtn.disabled = false; saveBtn.innerText = originalText; return; }
                if (newPwd.length < 8) { showToast('新密码至少 8 位'); saveBtn.disabled = false; saveBtn.innerText = originalText; return; }
                await changePassword(oldPwd, newPwd);
                showToast('资料和密码已更新');
            } else {
                showToast('资料已更新');
            }
            modal.style.display = 'none';
            _clearEditProfileForm();
            updateUserFromLogin(profile);
            _profileBioCache = profile;
            renderProfileHeader();
            _applyProfileBio(profile);
            if (typeof window.updateNavBar === 'function') window.updateNavBar();
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
export async function viewUserProfile(userId) {
    if (!isLoggedIn()) {
        const modal = document.getElementById('authModal');
        if (modal) modal.style.display = 'flex';
        return;
    }
    const me = getUser();
    if (me && String(me.id) === String(userId)) {
        _viewingUserId = null;
        _viewingProfileCache = null;
        currentProfileTab = 'posts';
        window._profileViewPending = true;
        if (typeof window.switchPage === 'function') {
            await window.switchPage('profile');
        } else {
            await refreshProfile();
        }
        return;
    }
    await showUserCardModal(userId);
}

export async function refreshProfile() {
    if (!isLoggedIn()) return;
    if (_viewingUserId && getUser() && String(getUser().id) === String(_viewingUserId)) {
        _viewingUserId = null;
        _viewingProfileCache = null;
    }
    await renderProfileHeader();
    if (isViewingSelf()) {
        loadProfileCover();
        loadProfileAvatar();
    }
    if (!isViewingSelf()) {
        currentProfileTab = 'posts';
    } else if (currentProfileTab === 'friends') {
        currentProfileTab = 'posts';
    }
    syncProfileTabUI(currentProfileTab);
    loadProfileTabContent(currentProfileTab);
}

export function resetProfileView() {
    _viewingUserId = null;
    _viewingProfileCache = null;
}

// ========== 初始化入口 ==========
export function initProfilePage() {
    ensureBubbleStyleEditor();
    initUserCardModal();
    initProfileTabs();
    initProfileStatJump();
    initEditProfile();
    initCoverEditor();
    initCoverViewer();
    initAvatarEditor();
    loadProfileCover();
    loadProfileAvatar();
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