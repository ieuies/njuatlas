const LOCAL_API_BASE = 'http://localhost:5000/api';
const LEGACY_API_BASE = 'https://api.njuatlas.cn/api';

const runtimeConfig = window.NJUATLAS_CONFIG || {};
const hostname = window.location.hostname;
const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '';

function productionApiBase() {
    if (typeof window !== 'undefined' && window.location?.origin) {
        return `${window.location.origin}/api`;
    }
    return LEGACY_API_BASE;
}

// 生产环境走同域 /api（Render 反代到 api.njuatlas.cn）；本地仍直连 :5000
export const API_BASE = runtimeConfig.API_BASE || (isLocal ? LOCAL_API_BASE : productionApiBase());
export const AMAP_KEY = runtimeConfig.AMAP_KEY || '97ac6e711cde17463af06c10b8b05f42';
export const AMAP_SECURITY_CODE = runtimeConfig.AMAP_SECURITY_CODE || '';

export function loadAmapScript() {
    if (window.AMap) return Promise.resolve(window.AMap);
    if (!AMAP_KEY || AMAP_KEY === 'YOUR_AMAP_KEY') {
        console.warn('AMAP_KEY is not configured. Map view will wait until a valid key is set.');
        return Promise.resolve(null);
    }

    const existing = document.querySelector('script[data-amap-loader="true"]');
    if (existing) {
        return new Promise((resolve, reject) => {
            if (window.AMap) {
                resolve(window.AMap);
                return;
            }
            existing.addEventListener('load', () => resolve(window.AMap));
            existing.addEventListener('error', reject);
        });
    }

    return new Promise((resolve, reject) => {
        if (AMAP_SECURITY_CODE) {
            window._AMapSecurityConfig = {
                securityJsCode: AMAP_SECURITY_CODE
            };
        }
        const script = document.createElement('script');
        script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(AMAP_KEY)}`;
        script.async = true;
        script.defer = true;
        script.dataset.amapLoader = 'true';
        script.onload = () => resolve(window.AMap);
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

let _amapPrefetchPromise = null;

/** 首页空闲时预加载高德 JS SDK，进入找搭子/地图页时可直接复用 */
export function prefetchAmapScript() {
    if (window.AMap) return Promise.resolve(window.AMap);
    if (_amapPrefetchPromise) return _amapPrefetchPromise;
    _amapPrefetchPromise = loadAmapScript().catch((err) => {
        _amapPrefetchPromise = null;
        console.warn('高德地图预加载失败:', err.message);
        return null;
    });
    return _amapPrefetchPromise;
}
