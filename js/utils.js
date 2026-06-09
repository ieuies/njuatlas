import { API_BASE } from './config.js';

export function showToast(msg, duration = 2500) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
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

export function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString();
}

// ============================================================
// 用户头像（本地存储，仅本人可见）
// 头像以裁剪后的 dataURL 形式保存在 localStorage，键按用户 ID 隔离。
// 由于没有“查看他人头像”的接口，头像仅存在于本人浏览器中。
// 未上传时回退为基于用户名生成的首字母色块。
// ============================================================
export function avatarStorageKey(user) {
    if (!user || user.id == null) return null;
    return `user_avatar_${user.id}`;
}

/** 返回头像描述对象：{ type:'image', src } 或 { type:'initial', initial, bg } */
export function getUserAvatar(user) {
    const key = avatarStorageKey(user);
    const saved = key ? localStorage.getItem(key) : null;
    if (saved) return { type: 'image', src: saved };
    const name = user?.username || (user?.email ? user.email.split('@')[0] : '同学');
    const initial = (name.charAt(0) || '?').toUpperCase();
    const hue = [...name].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
    return { type: 'initial', initial, bg: `hsl(${hue}, 55%, 55%)` };
}

/** 把用户头像渲染进指定容器元素（自适应容器圆角）。 */
export function renderAvatarInto(el, user, fontSize = '2rem') {
    if (!el) return;
    const avatar = getUserAvatar(user);
    if (avatar.type === 'image') {
        el.innerHTML = `<img src="${avatar.src}" alt="头像" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;">`;
        el.style.background = 'transparent';
    } else {
        el.innerHTML = `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:${fontSize};font-weight:800;color:#fff;background:${avatar.bg};border-radius:inherit;">${escapeHtml(avatar.initial)}</span>`;
        el.style.background = avatar.bg;
    }
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