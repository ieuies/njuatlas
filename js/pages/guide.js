import { API_BASE } from '../config.js';
import { getUser } from '../auth.js';
import { showToast } from '../utils.js';

const DEFAULT_CAMPUS = '鼓楼';
const ALL_CAMPUSES = ['鼓楼', '仙林', '浦口', '苏州'];

/** @type {{ campuses: Record<string, string>, categories: Record<string, object>, search_radius: number, page_size: number, sortrule: string } | null} */
let _guideConfig = null;

let currentGuideCat = 'all';
let currentGuideCampus = 'all';
/** @type {Record<string, { cats: Record<string, object[]>, gen: number, prefetching?: boolean, _inflight?: Record<string, Promise<object[]>>, _bundleInflight?: Promise<void> }>} */
let _guideCache = {};
let _isRefreshing = false;
let _randomOrder = false;
let _lastRenderKey = '';
let _guideRenderItems = [];
let _guideDataLoadedAt = 0;
let _prefetchTimer = null;
let _prefetchCategoryTimer = null;
let _prefetchPromise = null;

const GUIDE_RENDER_BATCH = 6;
const GUIDE_CACHE_TTL_MS = 5 * 60 * 1000;
const GUIDE_PREFETCH_DELAY_MS = 4500;
const GUIDE_CATEGORY_PREFETCH_GAP_MS = 900;
const GUIDE_IMG_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='200' fill='%23e8e4f0'/%3E";

function _guideCardHtml(item, idx) {
    return `
        <div class="guide-card" data-guide-idx="${idx}" data-guide-name="${esc(item.name)}">
            <img class="guide-img" src="${item.image || GUIDE_IMG_PLACEHOLDER}" alt="${esc(item.name)}" loading="lazy" decoding="async" fetchpriority="low">
            <div class="guide-info">
                <div class="guide-title">
                    ${esc(item.name)}
                    ${item.rating ? `<span class="guide-rating"><i class="fas fa-star" aria-hidden="true"></i> ${esc(String(item.rating))}</span>` : ''}
                </div>
                <div class="guide-desc">${esc(item.desc)}</div>
                <div class="guide-meta">
                    ${item.campus ? `<span class="guide-campus-tag"><i class="fas fa-location-dot" aria-hidden="true"></i> ${esc(item.campus)}校区</span>` : ''}
                    <span class="guide-type">${esc(item.type)}</span>
                    ${item.address ? `<span style="font-size:0.75rem;color:var(--text-tertiary);"><i class="fas fa-location-dot" aria-hidden="true"></i> ${esc(item.address)}</span>` : ''}
                    ${item.price ? `<span class="guide-price">${esc(item.price)}</span>` : ''}
                </div>
            </div>
        </div>`;
}

function _bindGuideGridDelegation(container) {
    if (container.dataset.guideBound === 'true') return;
    container.dataset.guideBound = 'true';
    container.addEventListener('click', (e) => {
        const card = e.target.closest('.guide-card');
        if (!card) return;
        const idx = parseInt(card.getAttribute('data-guide-idx'), 10);
        if (!Number.isNaN(idx) && _guideRenderItems[idx]) {
            openGuideDetail(_guideRenderItems[idx]);
        }
    });
}

function _categoryNames() {
    return _guideConfig ? Object.keys(_guideConfig.categories) : [];
}

function _getCacheKey() {
    return currentGuideCampus === 'all' ? 'all' : currentGuideCampus;
}

function _searchCity(campus) {
    return campus === '苏州' ? '苏州' : '南京';
}

async function _loadGuideConfig() {
    if (_guideConfig) return _guideConfig;
    const res = await fetch(`${API_BASE}/places/guide-config`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.message || `配置加载失败: ${res.status}`);
    }
    _guideConfig = data;
    return _guideConfig;
}

function _getCampusLocation(campus) {
    const coords = _guideConfig?.campuses?.[campus];
    if (coords) return coords;
    return _guideConfig?.campuses?.[DEFAULT_CAMPUS] || '118.780,32.058';
}

function _clearGuideCache() {
    _guideCache = {};
    _lastRenderKey = '';
}

function _renderKey(cacheKey, cat, items) {
    const names = (items || []).map(i => `${i.poi_id || i.name}:${i.type}`).join('\0');
    return `${cacheKey}\x1f${cat}\x1f${names}`;
}

function _setPrefetchHint(visible) {
    const container = document.getElementById('guideGrid');
    if (!container) return;
    let hint = container.querySelector('.guide-prefetch-hint');
    if (visible) {
        if (!hint) {
            hint = document.createElement('div');
            hint.className = 'guide-prefetch-hint';
            hint.textContent = '正在加载更多推荐…';
            container.appendChild(hint);
        }
        hint.hidden = false;
    } else if (hint) {
        hint.remove();
    }
}

function _isPrefetchComplete(cacheKey) {
    const cache = _guideCache[cacheKey];
    if (!cache) return true;
    return _categoryNames().every(cat => cache.cats[cat] !== undefined);
}

function _ensureCache(cacheKey) {
    if (!_guideCache[cacheKey]) {
        _guideCache[cacheKey] = { cats: {}, gen: 0 };
    }
    return _guideCache[cacheKey];
}

function _parseRating(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function _effectiveRating(item) {
    const amap = _parseRating(item.rating);
    const platform = _parseRating(item.platform_rating);
    if (platform && amap) return Math.max(amap, platform);
    return platform || amap;
}

function _sortScore(item) {
    const heat = (item.like_count || 0) * 2 + (item.review_count || 0);
    return _effectiveRating(item) * 10 + heat;
}

function _dedupeKey(item) {
    if (item.poi_id) return `poi:${item.poi_id}`;
    return `name:${item.name || ''}|addr:${item.address || ''}`;
}

const GUIDE_EXCLUDED_NAME_KEYWORDS = ['南京大学', '南大', '酒店', '政府部门', '商学院'];

function _isExcludedGuideName(name) {
    const n = (name || '').trim().replace(/（/g, '(').replace(/）/g, ')');
    return GUIDE_EXCLUDED_NAME_KEYWORDS.some(keyword => n.includes(keyword));
}

function _filterGuideItems(items) {
    return (items || []).filter(item => !_isExcludedGuideName(item.name));
}

function _dedupeGuideItems(items) {
    const seen = new Set();
    return items.filter(item => {
        const key = _dedupeKey(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function _sortGuideItems(items) {
    const list = _dedupeGuideItems(_filterGuideItems([...items]));
    if (_randomOrder) {
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [list[i], list[j]] = [list[j], list[i]];
        }
        return list;
    }
    list.sort((a, b) => {
        const diff = _sortScore(b) - _sortScore(a);
        if (diff !== 0) return diff;
        return (a.name || '').localeCompare(b.name || '', 'zh-CN');
    });
    return list;
}

function _getDisplayItems(cacheKey, cat) {
    const cache = _guideCache[cacheKey];
    if (!cache) return null;

    if (cat !== 'all') {
        const items = cache.cats[cat];
        return items !== undefined ? _sortGuideItems(items) : null;
    }

    const merged = [];
    let anyLoaded = false;
    for (const name of _categoryNames()) {
        if (cache.cats[name] !== undefined) {
            anyLoaded = true;
            merged.push(...cache.cats[name]);
        }
    }
    return anyLoaded ? _sortGuideItems(merged) : null;
}

function _getPriorityCategories() {
    if (currentGuideCat !== 'all') return [currentGuideCat];
    return ['美食'];
}

function _poisToItems(pois, cat, campus) {
    if (!Array.isArray(pois)) return [];
    return pois.map(poi => {
        const biz = poi.biz_ext || {};
        const cost = biz.cost;
        return {
            poi_id: String(poi.id || '').trim(),
            name: poi.name || '',
            desc: poi.address || '',
            image: poi.photos?.[0]?.url || '',
            type: cat,
            campus,
            rating: biz.rating || '',
            price: cost ? `¥${cost}/人` : '',
            address: poi.address || '',
            location: poi.location || '',
            like_count: 0,
            review_count: 0,
        };
    });
}

async function _searchPlacesQuiet(keyword, city, location, page, pageSize, radius, types, sortrule) {
    let url = `${API_BASE}/places/search?keyword=${encodeURIComponent(keyword)}&page=${page}&page_size=${pageSize}`;
    if (city) url += `&city=${encodeURIComponent(city)}`;
    if (location) url += `&location=${encodeURIComponent(location)}`;
    if (radius) url += `&radius=${encodeURIComponent(radius)}`;
    if (types) url += `&types=${encodeURIComponent(types)}`;
    if (sortrule) url += `&sortrule=${encodeURIComponent(sortrule)}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.message || `请求失败: ${res.status}`);
    }
    return data;
}

async function _fetchCategoryItems(campus, cat) {
    const cfg = _guideConfig.categories[cat];
    const location = _getCampusLocation(campus);
    const city = _searchCity(campus);
    const maxPages = cfg.max_pages || 2;
    const pageSize = _guideConfig.page_size;
    const targetCount = maxPages * pageSize;
    const maxAttempts = maxPages + 2;
    const pois = [];
    const seen = new Set();

    for (let page = 1; page <= maxAttempts && pois.length < targetCount; page++) {
        const r = await _searchPlacesQuiet(
            cfg.keyword || '',
            city,
            location,
            page,
            pageSize,
            _guideConfig.search_radius,
            cfg.types,
            _guideConfig.sortrule,
        );
        if (r.status !== '1' || !Array.isArray(r.pois) || r.pois.length === 0) break;
        for (const poi of r.pois) {
            if (_isExcludedGuideName(poi.name)) continue;
            const poiId = String(poi.id || '').trim();
            const key = poiId ? `poi:${poiId}` : `name:${poi.name || ''}|addr:${poi.address || ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            pois.push(poi);
            if (pois.length >= targetCount) break;
        }
        if (page >= maxPages && pois.length >= pageSize) break;
    }
    return _sortGuideItems(_poisToItems(pois, cat, campus));
}

async function _loadCategoryItemsForCacheKey(cacheKey, cat) {
    if (cacheKey === 'all') {
        const parts = await Promise.all(
            ALL_CAMPUSES.map(async (campus) => {
                try {
                    return await _fetchCategoryItems(campus, cat);
                } catch (fetchErr) {
                    console.warn(`高德搜索 ${cat}（${campus}）失败:`, fetchErr.message);
                    return [];
                }
            }),
        );
        return _sortGuideItems(parts.flat());
    }
    return _fetchCategoryItems(cacheKey, cat);
}

async function _loadCampusBundle(cacheKey, gen) {
    const cache = _ensureCache(cacheKey);
    if (cache.gen !== gen) return;
    if (_isPrefetchComplete(cacheKey)) return;
    if (cache._bundleInflight) return cache._bundleInflight;

    const bundleCampus = cacheKey === 'all' ? 'all' : cacheKey;

    cache._bundleInflight = (async () => {
        try {
            let url = `${API_BASE}/places/guide-bundle?campus=${encodeURIComponent(bundleCampus)}`;
            if (_randomOrder) url += '&shuffle=1';
            const res = await fetch(url);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || `请求失败: ${res.status}`);
            if (cache.gen !== gen) return;
            for (const cat of _categoryNames()) {
                const fromBundle = data.categories?.[cat];
                if (Array.isArray(fromBundle)) {
                    cache.cats[cat] = fromBundle;
                }
            }
        } catch (e) {
            console.warn(`guide-bundle（${bundleCampus}）失败，回退分分类请求:`, e.message);
            const todo = _categoryNames().filter(cat => cache.cats[cat] === undefined);
            for (const cat of todo) {
                if (cache.gen !== gen) break;
                try {
                    cache.cats[cat] = await _loadCategoryItemsForCacheKey(cacheKey, cat);
                } catch (fetchErr) {
                    console.warn(`指南回退加载 ${cat}（${cacheKey}）失败:`, fetchErr.message);
                    cache.cats[cat] = [];
                }
            }
        } finally {
            delete cache._bundleInflight;
            if (_guideCache[cacheKey]?.gen === gen) {
                _guideCache[cacheKey].prefetching = false;
            }
        }
    })();

    return cache._bundleInflight;
}

async function _loadCategory(cacheKey, cat, gen) {
    const cache = _ensureCache(cacheKey);
    if (cache.cats[cat] !== undefined) return cache.cats[cat];
    if (cache.gen !== gen) return [];

    cache._inflight = cache._inflight || {};
    if (cache._inflight[cat]) return cache._inflight[cat];

    cache._inflight[cat] = (async () => {
        try {
            if (cache.cats[cat] !== undefined) return cache.cats[cat];
            if (cache.gen !== gen) return [];

            const items = await _loadCategoryItemsForCacheKey(cacheKey, cat);
            if (cache.gen === gen) cache.cats[cat] = items;
            return items;
        } catch (e) {
            console.warn(`指南加载 ${cat}（${cacheKey}）失败:`, e.message);
            if (cache.gen === gen) cache.cats[cat] = [];
            return [];
        } finally {
            delete cache._inflight[cat];
        }
    })();

    return cache._inflight[cat];
}

function _maybeRender(cacheKey, gen, { force = false } = {}) {
    if (_getCacheKey() !== cacheKey) return;
    const cache = _guideCache[cacheKey];
    if (!cache || cache.gen !== gen) return;

    const items = _getDisplayItems(cacheKey, currentGuideCat);
    if (items === null) return;

    const key = _renderKey(cacheKey, currentGuideCat, items);
    if (!force && key === _lastRenderKey) return;

    renderGuideGrid(items, { cacheKey, cat: currentGuideCat, renderKey: key });

    if (_isPrefetchComplete(cacheKey)) {
        _setPrefetchHint(false);
    }
}

function _cancelScheduledPrefetch() {
    if (_prefetchTimer) {
        clearTimeout(_prefetchTimer);
        _prefetchTimer = null;
    }
    if (_prefetchCategoryTimer) {
        clearTimeout(_prefetchCategoryTimer);
        _prefetchCategoryTimer = null;
    }
}

function _isGuidePageActive() {
    return document.getElementById('guidePage')?.classList.contains('active-page');
}

function _prefetchNextCategory(cacheKey) {
    const cache = _guideCache[cacheKey];
    if (!cache || !_isGuidePageActive() || _getCacheKey() !== cacheKey) {
        _setPrefetchHint(false);
        return;
    }
    if (_isPrefetchComplete(cacheKey)) {
        _setPrefetchHint(false);
        return;
    }

    const nextCat = _categoryNames().find((cat) => cache.cats[cat] === undefined);
    if (!nextCat) {
        _setPrefetchHint(false);
        return;
    }

    const gen = cache.gen;
    if (currentGuideCat === 'all') _setPrefetchHint(true);

    _loadCategory(cacheKey, nextCat, gen).then(() => {
        if (_guideCache[cacheKey]?.gen !== gen || !_isGuidePageActive()) return;
        _maybeRender(cacheKey, gen);
        _prefetchCategoryTimer = setTimeout(() => {
            _prefetchCategoryTimer = null;
            _prefetchNextCategory(cacheKey);
        }, GUIDE_CATEGORY_PREFETCH_GAP_MS);
    });
}

/** 首屏后再逐个分类懒加载，避免 guide-bundle 占满后端 worker */
function _scheduleIncrementalPrefetch(cacheKey) {
    if (_isPrefetchComplete(cacheKey)) return;
    _cancelScheduledPrefetch();
    _prefetchTimer = setTimeout(() => {
        _prefetchTimer = null;
        if (!_isGuidePageActive() || _getCacheKey() !== cacheKey) return;
        _prefetchNextCategory(cacheKey);
    }, GUIDE_PREFETCH_DELAY_MS);
}

function renderGuideGrid(items, meta = {}) {
    const container = document.getElementById('guideGrid');
    if (!container) return;

    if (!items || items.length === 0) {
        _lastRenderKey = '';
        _guideRenderItems = [];
        container.innerHTML = '<div class="guide-loading">该分类暂无推荐～</div>';
        return;
    }

    const cacheKey = meta.cacheKey ?? _getCacheKey();
    const cat = meta.cat ?? currentGuideCat;
    const renderKey = meta.renderKey ?? _renderKey(cacheKey, cat, items);
    if (renderKey === _lastRenderKey) return;
    _lastRenderKey = renderKey;
    _guideRenderItems = items;
    _bindGuideGridDelegation(container);

    if (items.length <= GUIDE_RENDER_BATCH) {
        container.innerHTML = items.map((item, idx) => _guideCardHtml(item, idx)).join('');
        return;
    }

    container.innerHTML = '';
    let index = 0;
    const paintBatch = () => {
        const end = Math.min(index + GUIDE_RENDER_BATCH, items.length);
        let html = '';
        for (; index < end; index++) {
            html += _guideCardHtml(items[index], index);
        }
        container.insertAdjacentHTML('beforeend', html);
        if (index < items.length) {
            requestAnimationFrame(paintBatch);
        }
    };
    requestAnimationFrame(paintBatch);
}

async function _applyGuideFilters(force = false) {
    const container = document.getElementById('guideGrid');
    const cacheKey = _getCacheKey();

    if (force) {
        const c = _ensureCache(cacheKey);
        c.gen += 1;
        c.cats = {};
        c._inflight = {};
        c._bundleInflight = null;
        c.prefetching = false;
        _lastRenderKey = '';
        _setPrefetchHint(false);
        _cancelScheduledPrefetch();
        const gen = c.gen;
        if (container) container.innerHTML = '<div class="guide-loading">加载中...</div>';
        await _loadCampusBundle(cacheKey, gen);
        const bundleItems = _getDisplayItems(cacheKey, currentGuideCat);
        if (bundleItems !== null) {
            renderGuideGrid(bundleItems, { cacheKey, cat: currentGuideCat });
        } else if (container) {
            container.innerHTML = '<div class="guide-loading">该分类暂无推荐～</div>';
        }
        _guideDataLoadedAt = Date.now();
        return;
    }

    const cached = _getDisplayItems(cacheKey, currentGuideCat);
    if (cached !== null) {
        renderGuideGrid(cached, { cacheKey, cat: currentGuideCat });
        _scheduleIncrementalPrefetch(cacheKey);
        return;
    }

    const cache = _ensureCache(cacheKey);
    const gen = cache.gen;
    const needed = (currentGuideCat === 'all' ? _getPriorityCategories() : [currentGuideCat])
        .filter(cat => cache.cats[cat] === undefined);

    if (needed.length > 0) {
        if (container) container.innerHTML = '<div class="guide-loading">加载中...</div>';
        await Promise.all(needed.map(cat => _loadCategory(cacheKey, cat, gen)));
    }

    const items = _getDisplayItems(cacheKey, currentGuideCat);
    if (items !== null) {
        renderGuideGrid(items, { cacheKey, cat: currentGuideCat });
    } else if (container) {
        _lastRenderKey = '';
        container.innerHTML = '<div class="guide-loading">该分类暂无推荐～</div>';
    }

    _guideDataLoadedAt = Date.now();
    _scheduleIncrementalPrefetch(cacheKey);
}

export async function refreshGuideData() {
    if (_isRefreshing) {
        showToast('刷新中，请稍候...');
        return;
    }
    const btn = document.getElementById('refreshGuideBtn');
    try {
        _isRefreshing = true;
        if (btn) {
            btn.classList.add('refreshing');
            btn.disabled = true;
        }
        showToast('正在刷新数据...');
        _randomOrder = true;
        _clearGuideCache();
        await _applyGuideFilters(true);
        showToast('刷新成功');
    } catch (err) {
        console.error('刷新失败:', err);
        showToast('刷新失败，请稍后重试');
    } finally {
        _isRefreshing = false;
        if (btn) {
            btn.classList.remove('refreshing');
            btn.disabled = false;
        }
    }
}

function filterGuideItems(cat) {
    currentGuideCat = cat;
    _randomOrder = false;
    _lastRenderKey = '';
    document.querySelectorAll('#guideFilter .guide-chip').forEach(chip => {
        chip.classList.toggle('active', chip.getAttribute('data-guide-cat') === cat);
    });
    _applyGuideFilters();
}

function _filterGuideCampus(campus) {
    currentGuideCampus = campus;
    _randomOrder = false;
    _lastRenderKey = '';
    document.querySelectorAll('#guideCampusFilter .guide-chip').forEach(chip => {
        chip.classList.toggle('active', chip.getAttribute('data-guide-campus') === campus);
    });
    _applyGuideFilters();
}

function openGuideDetail(item) {
    const modal = document.getElementById('guideDetailModal');
    if (!modal) return;
    document.getElementById('guideDetailImg').src = item.image || '';
    document.getElementById('guideDetailName').textContent = item.name;
    document.getElementById('guideDetailRating').innerHTML = item.rating
        ? `<i class="fas fa-star" aria-hidden="true"></i> ${esc(String(item.rating))}`
        : '';
    document.getElementById('guideDetailPrice').textContent = item.price || '';
    document.getElementById('guideDetailPrice').style.cssText = item.price
        ? 'font-weight:700;color:var(--danger);'
        : '';
    document.getElementById('guideDetailType').textContent = item.type || '';
    document.getElementById('guideDetailType').style.cssText = item.type
        ? 'padding:3px 10px;border-radius:10px;font-size:0.75rem;background:var(--bg-tertiary);color:var(--text-secondary);'
        : '';
    document.getElementById('guideDetailDesc').textContent = item.desc || '';
    document.getElementById('guideDetailAddr').innerHTML = item.address
        ? `<i class="fas fa-location-dot" aria-hidden="true"></i> ${esc(item.address)}`
        : '';
    modal.style.display = 'flex';
}

function initGuideModals() {
    const modal = document.getElementById('guideDetailModal');
    if (!modal || modal.dataset.ready) return;
    modal.dataset.ready = '1';
    document.getElementById('closeGuideDetailBtn')?.addEventListener('click', () => {
        modal.style.display = 'none';
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
    });
}

function initGuideFilter() {
    const filterBar = document.getElementById('guideFilter');
    if (!filterBar || filterBar.dataset.ready) return;
    filterBar.dataset.ready = '1';
    filterBar.querySelectorAll('.guide-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            filterGuideItems(chip.getAttribute('data-guide-cat'));
        });
    });
}

function initGuideCampusFilter() {
    const filterBar = document.getElementById('guideCampusFilter');
    if (!filterBar || filterBar.dataset.ready) return;
    filterBar.dataset.ready = '1';

    const user = getUser();
    const userCampus = user?.campus || '';
    if (userCampus && ALL_CAMPUSES.includes(userCampus)) {
        currentGuideCampus = userCampus;
        document.querySelectorAll('#guideCampusFilter .guide-chip').forEach(chip => {
            chip.classList.toggle('active', chip.getAttribute('data-guide-campus') === userCampus);
        });
    }

    filterBar.querySelectorAll('.guide-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            _filterGuideCampus(chip.getAttribute('data-guide-campus'));
        });
    });
}

function bindRefreshButton() {
    const refreshBtn = document.getElementById('refreshGuideBtn');
    if (!refreshBtn || refreshBtn.dataset.refreshBound) return;
    refreshBtn.dataset.refreshBound = 'true';
    refreshBtn.addEventListener('click', (e) => {
        e.preventDefault();
        refreshGuideData();
    });
}

export async function loadGuideData({ force = false } = {}) {
    initGuideModals();
    initGuideFilter();
    initGuideCampusFilter();
    bindRefreshButton();

    if (!force) {
        const cacheKey = _getCacheKey();
        const cached = _getDisplayItems(cacheKey, currentGuideCat);
        if (
            cached !== null
            && _guideDataLoadedAt
            && (Date.now() - _guideDataLoadedAt) < GUIDE_CACHE_TTL_MS
        ) {
            renderGuideGrid(cached, { cacheKey, cat: currentGuideCat });
            _scheduleIncrementalPrefetch(cacheKey);
            return;
        }
    }

    try {
        await _loadGuideConfig();
        await _applyGuideFilters(force);
    } catch (err) {
        console.error('吃喝玩乐配置加载失败:', err);
        showToast('加载失败，请稍后重试');
    }
}

/** 再次进入页面：优先用内存缓存秒开 */
export function refreshGuideView() {
    const cacheKey = _getCacheKey();
    const cached = _getDisplayItems(cacheKey, currentGuideCat);
    if (cached !== null && _guideDataLoadedAt) {
        renderGuideGrid(cached, { cacheKey, cat: currentGuideCat });
        if (!_isPrefetchComplete(cacheKey)) _scheduleIncrementalPrefetch(cacheKey);
        return;
    }
    loadGuideData();
}

/** 离开吃喝玩乐页时停止后台预取 */
export function onGuidePageHidden() {
    _cancelScheduledPrefetch();
    _setPrefetchHint(false);
}

/** 导航悬停时预拉配置 + 美食分类 */
export function prefetchGuideData() {
    if (_prefetchPromise) return _prefetchPromise;
    _prefetchPromise = (async () => {
        try {
            await _loadGuideConfig();
            const cacheKey = _getCacheKey();
            const cache = _ensureCache(cacheKey);
            if (cache.cats['美食'] !== undefined) return;
            await _loadCategory(cacheKey, '美食', cache.gen);
            _guideDataLoadedAt = Date.now();
        } catch (e) {
            _prefetchPromise = null;
        }
    })();
    return _prefetchPromise;
}

export function initGuidePage() {
    const container = document.getElementById('guideGrid');
    const cacheKey = _getCacheKey();
    const hasData = _getDisplayItems(cacheKey, currentGuideCat);
    if (container && !container.querySelector('.guide-card') && hasData === null) {
        container.innerHTML = '<div class="guide-loading">加载精彩推荐中...</div>';
    }
    loadGuideData();
}

function esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
