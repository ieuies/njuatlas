import { escapeHtml, isMobileViewport } from '../../utils.js';
import { prefetchAmapScript } from '../../config.js';
import { partnerStore } from './shared.js';
import { getMapCenter, categoryStyle } from './shared.js';

let _sharedMap = null;
let _sharedMapContainer = null;
let _previewMapPending = false;
let _previewMapInFlight = false;
async function _initPreviewMapCore() {
    await ensureAMap();
    const map = getOrCreateSharedMap('preview');
    if (map) {
        addMarkersToMap(map, partnerStore.partnersData);
    }
}

function _queuePreviewMapInit() {
    if (isMobileViewport()) return;
    _previewMapPending = true;
    if (_previewMapInFlight) return;
    _previewMapInFlight = true;
    _previewMapPending = false;

    // 组局已就绪后再加载地图；复用全局预拉，下一帧初始化
    prefetchAmapScript().catch(() => {});

    requestAnimationFrame(() => {
        _initPreviewMapCore()
            .catch((err) => console.warn('预览地图初始化失败:', err))
            .finally(() => {
                _previewMapInFlight = false;
                if (_previewMapPending) _queuePreviewMapInit();
            });
    });
}

/** 帖子渲染完成后再加载高德 SDK 与预览地图（不阻塞列表） */
export function schedulePreviewMapAfterPosts() {
    if (isMobileViewport()) return;
    _queuePreviewMapInit();
}

// ============================================================
// 高德地图初始化
// ============================================================
async function ensureAMap() {
    if (window.AMap) return window.AMap;
    try {
        await prefetchAmapScript();
        if (window.AMap) return window.AMap;
        throw new Error('AMap SDK 加载后 window.AMap 仍然不可用');
    } catch (err) {
        console.warn('高德地图加载失败:', err.message);
        throw err;
    }
}

export function getOrCreateSharedMap(targetParent) {
    const containerId = targetParent === 'full' ? 'fullMap' : 'previewMap';
    const target = document.getElementById(containerId);
    if (!target) return null;

    if (_sharedMap && partnerStore.currentMapParent === targetParent) {
        return _sharedMap;
    }

    const center = getMapCenter();

    if (!_sharedMap) {
        _sharedMapContainer = document.createElement('div');
        _sharedMapContainer.style.cssText = 'width:100%;height:100%;';
        target.innerHTML = '';
        target.appendChild(_sharedMapContainer);

        _sharedMap = new window.AMap.Map(_sharedMapContainer, {
            zoom: 15,
            center: center,
            mapStyle: 'amap://styles/light',
            resizeEnable: false,
        });
        partnerStore.currentMapParent = targetParent;
        _setupResizeObserver();
    } else {
        target.innerHTML = '';
        target.appendChild(_sharedMapContainer);
        partnerStore.currentMapParent = targetParent;
        _sharedMap.resize();
        if (_resizeObserver && _sharedMapContainer) {
            _resizeObserver.unobserve(_sharedMapContainer);
            _resizeObserver.observe(_sharedMapContainer);
        }
    }
    return _sharedMap;
}

function _destroySharedMap() {
    if (_sharedMap) {
        _sharedMap.destroy();
        _sharedMap = null;
        _sharedMapContainer = null;
        partnerStore.currentMapParent = null;
    }
    if (_resizeObserver) {
        _resizeObserver.disconnect();
        _resizeObserver = null;
    }
}

let _resizeObserver = null;
let _resizeTimer = null;

function _setupResizeObserver() {
    if (_resizeObserver) return;
    if (!window.ResizeObserver) return;
    _resizeObserver = new ResizeObserver((entries) => {
        if (!_sharedMap) return;
        for (const entry of entries) {
            if (entry.target === _sharedMapContainer && entry.contentRect.width > 0) {
                clearTimeout(_resizeTimer);
                _resizeTimer = setTimeout(() => {
                    if (_sharedMap) _sharedMap.resize();
                }, 300);
                break;
            }
        }
    });
    if (_sharedMapContainer) {
        _resizeObserver.observe(_sharedMapContainer);
    }
}

const _iconCache = {};
function _getMarkerIcon(color) {
    if (!_iconCache[color]) {
        _iconCache[color] = new window.AMap.Icon({
            size: new window.AMap.Size(32, 32),
            image: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="${color}" stroke="white" stroke-width="3"/></svg>`)}`,
            imageSize: new window.AMap.Size(32, 32),
        });
    }
    return _iconCache[color];
}

let __markerOffset = null;
function _getMarkerOffset() {
    if (!__markerOffset) __markerOffset = new window.AMap.Pixel(-16, -16);
    return __markerOffset;
}
let __infoWindowOffset = null;
function _getInfoWindowOffset() {
    if (!__infoWindowOffset) __infoWindowOffset = new window.AMap.Pixel(0, -36);
    return __infoWindowOffset;
}

let _sharedInfoWindow = null;

function _openInfoWindow(map, coords, post, style) {
    const infoContent = `
        <div class="amap-info-content" style="max-width:240px;font-size:0.85rem;">
            <strong style="color:${style.color};">${escapeHtml(post.category)}</strong>
            <div style="font-weight:700;margin:4px 0;">${escapeHtml(post.title)}</div>
            <div style="color:#666;">${escapeHtml(post.description).substring(0, 80)}</div>
            ${post.time ? `<div>时间：${escapeHtml(post.time)}</div>` : ''}
            <button class="map-join-btn" data-post-id="${post.id}" style="margin-top:8px;padding:6px 14px;background:#6B21A5;color:white;border:none;border-radius:12px;cursor:pointer;font-size:0.8rem;">我要参加</button>
        </div>
    `;
    if (!_sharedInfoWindow) {
        _sharedInfoWindow = new window.AMap.InfoWindow({
            offset: _getInfoWindowOffset(),
        });
    }
    _sharedInfoWindow.setContent(infoContent);
    _sharedInfoWindow.open(map, coords);
}

export function addMarkersToMap(map, data) {
    map.clearMap();
    if (!data.length) return [];

    const markers = [];
    data.forEach(post => {
        const coords = post.lnglat;
        if (!coords || coords.length < 2 || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) {
            return;
        }
        const style = categoryStyle(post.category);
        const marker = new window.AMap.Marker({
            position: coords,
            title: post.title,
            icon: _getMarkerIcon(style.color),
            offset: _getMarkerOffset(),
            zIndex: 100,
        });
        marker.on('click', () => _openInfoWindow(map, coords, post, style));
        markers.push(marker);
    });
    if (markers.length > 0) {
        map.add(markers);
    }
    return markers;
}

export function initPreviewMap() {
    schedulePreviewMapAfterPosts();
}

export function refreshPreviewMarkers() {
    if (isMobileViewport()) return;
    if (partnerStore.currentMapParent === 'full') return;
    if (_sharedMap && partnerStore.currentMapParent === 'preview') {
        addMarkersToMap(_sharedMap, partnerStore.partnersData);
        return;
    }
    _previewMapPending = true;
    if (!_previewMapInFlight) _queuePreviewMapInit();
}

export async function initFullMapMarkers() {
    try {
        await ensureAMap();
        const container = document.getElementById('fullMap');
        if (!container || container.offsetWidth === 0) {
            await new Promise(r => setTimeout(r, 200));
        }
        const map = getOrCreateSharedMap('full');
        if (map) {
            addMarkersToMap(map, partnerStore.partnersData);
            requestAnimationFrame(() => map.resize());
        }
    } catch (err) {
        console.warn('全屏地图初始化失败:', err);
    }
}
