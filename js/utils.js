import { API_BASE } from './config.js';

export function isMobileViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
}

export function getAppScroller() {
    return document.getElementById('contentArea') || document.documentElement;
}

const MAX_TOASTS = 6;

function getToastContainer() {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'false');
        document.body.appendChild(container);
    }
    return container;
}

export function showToast(msg, duration = 2500) {
    const container = getToastContainer();
    while (container.children.length >= MAX_TOASTS) {
        container.firstElementChild?.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = msg;
    container.appendChild(toast);

    const remove = () => {
        if (!toast.isConnected) return;
        toast.classList.add('toast-leaving');
        const done = () => toast.remove();
        toast.addEventListener('transitionend', done, { once: true });
        setTimeout(done, 320);
    };
    setTimeout(remove, duration);
}

export function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

/** 轻量 inline 转圈（消息发送中、评论加载等） */
export function atlasInlineSpinnerHtml({ label = '加载中', className = '' } = {}) {
    const cls = ['atlas-inline-spinner', className].filter(Boolean).join(' ');
    return `<span class="${cls}" role="status" aria-label="${escapeHtml(label)}"></span>`;
}

export const BEIJING_TZ = 'Asia/Shanghai';

/** 解析 API 返回的时间：无时区的 ISO 字符串按 UTC 处理（SQLite 存 UTC） */
export function parseApiDate(iso) {
    if (iso == null || iso === '') return null;
    if (iso instanceof Date) return iso;
    const s = String(iso).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(s)) {
        return new Date(`${s}Z`);
    }
    return new Date(s);
}

export function beijingDateKey(date) {
    if (!date || Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-CA', { timeZone: BEIJING_TZ });
}

export function formatDate(iso, options = {}) {
    const d = parseApiDate(iso);
    if (!d || Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('zh-CN', {
        timeZone: BEIJING_TZ,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        ...options,
    });
}

/** 月/日 时:分（AI 会话列表等） */
export function formatDateShort(iso, options = {}) {
    const d = parseApiDate(iso);
    if (!d || Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('zh-CN', {
        timeZone: BEIJING_TZ,
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        ...options,
    });
}

/** 相对时间 + 过久则显示北京日期 */
export function formatRelativeTime(iso) {
    const date = parseApiDate(iso);
    if (!date || Number.isNaN(date.getTime())) return '';
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;
    return date.toLocaleDateString('zh-CN', {
        timeZone: BEIJING_TZ,
        month: 'short',
        day: 'numeric',
    });
}

/** 消息列表：今天显示 HH:mm，否则 M/D（北京时间） */
export function formatTimeBrief(iso) {
    const d = parseApiDate(iso);
    if (!d || Number.isNaN(d.getTime())) return '';
    const todayKey = beijingDateKey(new Date());
    const dateKey = beijingDateKey(d);
    const time = d.toLocaleString('zh-CN', {
        timeZone: BEIJING_TZ,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    if (dateKey === todayKey) return time;
    const md = d.toLocaleString('zh-CN', {
        timeZone: BEIJING_TZ,
        month: 'numeric',
        day: 'numeric',
    });
    return md;
}

// ============================================================
// 用户头像：优先服务端 avatar_url（跨设备一致），本人无服务端头像时回退 localStorage
// ============================================================
// ============================================================
// API 静态资源 URL（头像、封面等）：统一补全 /api 前缀与域名
// ============================================================
export function resolveApiAssetUrl(raw, { cacheBust = false } = {}) {
    if (!raw || typeof raw !== 'string') return '';
    if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;

    if (/^https?:\/\//i.test(raw)) {
        try {
            const u = new URL(raw);
            if (u.hostname === 'api.njuatlas.cn' && typeof window !== 'undefined' && window.location?.origin) {
                u.protocol = window.location.protocol;
                u.host = window.location.host;
            }
            if (u.pathname.startsWith('/social/') && !u.pathname.startsWith('/api/')) {
                u.pathname = `/api${u.pathname}`;
            }
            let out = u.toString();
            if (cacheBust) out += `${out.includes('?') ? '&' : '?'}_=${Date.now()}`;
            return out;
        } catch {
            if (cacheBust) return `${raw}${raw.includes('?') ? '&' : '?'}_=${Date.now()}`;
            return raw;
        }
    }

    let path = raw.startsWith('/') ? raw : `/${raw}`;
    if (path.startsWith('/social/') && !path.startsWith('/api/')) {
        path = `/api${path}`;
    }
    const base = API_BASE.replace(/\/api\/?$/, '');
    const url = `${base}${path}`;
    if (cacheBust) return `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`;
    return url;
}

export function resolveAvatarUrl(url) {
    if (!url) return null;
    return resolveApiAssetUrl(url) || null;
}

function getCurrentUserId() {
    try {
        const raw = localStorage.getItem('current_user');
        if (raw) {
            const id = JSON.parse(raw)?.id;
            if (id != null) return String(id);
        }
    } catch (e) { /* ignore */ }
    return null;
}

function isSelfUser(user) {
    const uid = user?.id;
    if (uid == null) return false;
    const currentId = getCurrentUserId();
    return currentId != null && String(uid) === currentId;
}

export function avatarStorageKey(user) {
    if (!user || user.id == null) return null;
    return `user_avatar_${user.id}`;
}

export function avatarVersionKey(userId) {
    return userId != null ? `user_avatar_ver_${userId}` : null;
}

export function bumpAvatarVersion(userId) {
    const key = avatarVersionKey(userId);
    if (key) localStorage.setItem(key, String(Date.now()));
}

export function getAvatarInitial(user) {
    const name = user?.username || (user?.email ? user.email.split('@')[0] : '同学');
    const initial = (name.charAt(0) || '?').toUpperCase();
    const hue = [...name].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
    return { initial, bg: `hsl(${hue}, 55%, 55%)` };
}

/** 服务端图片 404 时：本人可试 localStorage；否则隐藏 img，保留首字母层 */
function handleAvatarImgError(img) {
    const uid = img.dataset.userId;
    const currentId = getCurrentUserId();
    if (uid && currentId && uid === currentId && img.dataset.avatarRetry !== '1') {
        const saved = localStorage.getItem(`user_avatar_${uid}`);
        if (saved && img.src !== saved) {
            img.dataset.avatarRetry = '1';
            img.src = saved;
            return;
        }
        if (/\/users\/\d+\/avatar/.test(img.src || '')) {
            import('./auth.js').then(({ clearSelfCanonicalAvatarUrl }) => clearSelfCanonicalAvatarUrl()).catch(() => {});
        }
    }
    img.style.display = 'none';
    img.removeAttribute('src');
    const slot = img.closest('.user-avatar-slot');
    const initial = slot?.querySelector('.user-avatar-initial');
    if (initial) {
        initial.style.display = 'inline-flex';
    }
}

if (typeof window !== 'undefined' && !window.__njuAtlasAvatarErr) {
    window.__njuAtlasAvatarErr = handleAvatarImgError;
}

/** 返回头像描述对象：{ type:'image', src } 或 { type:'initial', initial, bg } */
export function getUserAvatar(user) {
    const serverUrl = resolveAvatarUrl(user?.avatar_url);
    if (serverUrl) {
        let src = serverUrl;
        const canonical = /\/users\/\d+\/avatar/.test(user?.avatar_url || serverUrl);
        if (canonical) {
            const verKey = avatarVersionKey(user?.id);
            const ver = verKey ? localStorage.getItem(verKey) : null;
            if (ver) src = `${serverUrl}${serverUrl.includes('?') ? '&' : '?'}v=${ver}`;
        }
        return { type: 'image', src };
    }

    // 仅当服务端尚无头像时，本机裁剪图作为离线回退
    if (isSelfUser(user)) {
        const key = avatarStorageKey(user);
        const saved = key ? localStorage.getItem(key) : null;
        if (saved?.startsWith('data:')) return { type: 'image', src: saved };
    }

    return { type: 'initial', ...getAvatarInitial(user) };
}

function bindAvatarImg(img, user) {
    if (!img || img.dataset.avatarBound === '1') return;
    img.dataset.avatarBound = '1';
    if (user?.id != null) img.dataset.userId = String(user.id);
    img.addEventListener('error', () => handleAvatarImgError(img));
}

/** 渲染用户头像到容器；user 可为 { id, username, avatar_url } */
export function renderAvatarInto(el, user, fontSize = '2rem') {
    if (!el) return;
    const avatar = getUserAvatar(user);
    const init = getAvatarInitial(user);
    if (avatar.type === 'image') {
        el.style.position = 'relative';
        el.style.background = init.bg;
        el.innerHTML = `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:${fontSize};font-weight:800;color:#fff;border-radius:inherit;">${escapeHtml(init.initial)}</span>`;
        const img = document.createElement('img');
        img.src = avatar.src;
        img.alt = '头像';
        img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;';
        bindAvatarImg(img, user);
        el.appendChild(img);
    } else {
        el.style.background = avatar.bg;
        el.innerHTML = `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:${fontSize};font-weight:800;color:#fff;background:${avatar.bg};border-radius:inherit;">${escapeHtml(avatar.initial)}</span>`;
    }
}

/** 生成可复用的头像 HTML 字符串（用于列表卡片等） */
export function avatarHtmlForUser(user, size = 40, { lazy = false } = {}) {
    const avatar = getUserAvatar(user);
    const init = getAvatarInitial(user);
    const fs = size * 0.42;
    const initialStyle = `display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;font-size:${fs}px;font-weight:800;color:#fff;background:${init.bg};`;
    const lazyAttr = lazy ? ' loading="lazy" decoding="async"' : '';
    if (avatar.type === 'image') {
        const uidAttr = user?.id != null ? ` data-user-id="${user.id}"` : '';
        return `<span class="user-avatar-slot" style="position:relative;display:inline-flex;width:${size}px;height:${size}px;flex-shrink:0;">` +
            `<span class="user-avatar-initial" style="${initialStyle}">${escapeHtml(init.initial)}</span>` +
            `<img class="user-avatar-img"${uidAttr} src="${escapeHtml(avatar.src)}" alt="" width="${size}" height="${size}"${lazyAttr} ` +
            `style="position:absolute;inset:0;width:100%;height:100%;border-radius:50%;object-fit:cover;" onerror="window.__njuAtlasAvatarErr?.(this)">` +
            `</span>`;
    }
    return `<span class="user-avatar-initial" style="${initialStyle}">${escapeHtml(init.initial)}</span>`;
}

// ============================================================
// WGS-84 → GCJ-02 坐标转换（国测局坐标系）
// 高德地图使用 GCJ-02 瓦片，若硬编码坐标来自 GPS/Google Maps
// （WGS-84），需先转换再传给 AMap，否则会有 ~300-500m 偏移。
// 从高德 API 返回的坐标已经是 GCJ-02，无需再次转换。
// ============================================================
const PI = Math.PI;
const X_PI = (PI * 3000.0) / 180.0;
const A = 6378245.0;          // 长半轴
const EE = 0.00669342162296594323; // 第一偏心率平方

function _transformLat(x, y) {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
    ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
    ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320.0 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
    return ret;
}

function _transformLng(x, y) {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
    ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
    ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
    return ret;
}

function _outOfChina(lng, lat) {
    return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

/**
 * 将 WGS-84 坐标转换为 GCJ-02（火星坐标系）。
 * 中国境外坐标原样返回（无需加偏）。
 * @param {number} lng - WGS-84 经度
 * @param {number} lat - WGS-84 纬度
 * @returns {[number, number]} GCJ-02 [经度, 纬度]
 */
export function wgs84ToGcj02(lng, lat) {
    if (_outOfChina(lng, lat)) {
        return [lng, lat];
    }
    let dlat = _transformLat(lng - 105.0, lat - 35.0);
    let dlng = _transformLng(lng - 105.0, lat - 35.0);
    const radlat = (lat / 180.0) * PI;
    let magic = Math.sin(radlat);
    magic = 1 - EE * magic * magic;
    const sqrtmagic = Math.sqrt(magic);
    dlat = (dlat * 180.0) / (((A * (1 - EE)) / (magic * sqrtmagic)) * PI);
    dlng = (dlng * 180.0) / ((A / sqrtmagic) * Math.cos(radlat) * PI);
    return [lng + dlng, lat + dlat];
}