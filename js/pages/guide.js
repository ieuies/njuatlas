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
    const list = _dedupeGuideItems([...items]);
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
    const pois = [];
    for (let page = 1; page <= maxPages; page++) {
        const r = await _searchPlacesQuiet(
            cfg.keyword || '',
            city,
            location,
            page,
            _guideConfig.page_size,
            _guideConfig.search_radius,
            cfg.types,
            _guideConfig.sortrule,
        );
        if (r.status !== '1' || !Array.isArray(r.pois) || r.pois.length === 0) break;
        pois.push(...r.pois);
    }
    return _sortGuideItems(_poisToItems(pois, cat, campus));
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
                if (cache.cats[cat] !== undefined) continue;
                cache.cats[cat] = Array.isArray(data.categories?.[cat]) ? data.categories[cat] : [];
            }
        } catch (e) {
            console.warn(`guide-bundle（${bundleCampus}）失败，回退分分类请求:`, e.message);
            const campuses = cacheKey === 'all' ? ALL_CAMPUSES : [cacheKey];
            const todo = _categoryNames().filter(cat => cache.cats[cat] === undefined);
            for (const cat of todo) {
                const merged = [];
                for (const campus of campuses) {
                    try {
                        merged.push(...await _fetchCategoryItems(campus, cat));
                    } catch (fetchErr) {
                        console.warn(`高德搜索 ${cat}（${campus}）失败:`, fetchErr.message);
                    }
                }
                if (cache.gen === gen) {
                    cache.cats[cat] = _sortGuideItems(merged);
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
            if (cacheKey === 'all') {
                await _loadCampusBundle(cacheKey, gen);
                return cache.cats[cat] || [];
            }
            const items = await _fetchCategoryItems(cacheKey, cat);
            if (cache.gen === gen) cache.cats[cat] = items;
            return items;
        } catch (e) {
            console.warn(`高德搜索 ${cat}（${cacheKey}）失败:`, e.message);
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

function _kickPrefetch(cacheKey) {
    const cache = _guideCache[cacheKey];
    if (!cache || cache.prefetching || cache._bundleInflight) return;
    if (_isPrefetchComplete(cacheKey)) return;

    const gen = cache.gen;
    cache.prefetching = true;
    if (currentGuideCat === 'all' && _getCacheKey() === cacheKey) {
        _setPrefetchHint(true);
    }
    (async () => {
        await _loadCampusBundle(cacheKey, gen);
        if (_guideCache[cacheKey]?.gen === gen) {
            if (currentGuideCat === 'all' && _getCacheKey() === cacheKey) {
                _maybeRender(cacheKey, gen, { force: true });
            } else {
                _setPrefetchHint(false);
            }
        }
    })();
}

function renderGuideGrid(items, meta = {}) {
    const container = document.getElementById('guideGrid');
    if (!container) return;

    if (!items || items.length === 0) {
        _lastRenderKey = '';
        container.innerHTML = '<div class="guide-loading">该分类暂无推荐～</div>';
        return;
    }

    const cacheKey = meta.cacheKey ?? _getCacheKey();
    const cat = meta.cat ?? currentGuideCat;
    const renderKey = meta.renderKey ?? _renderKey(cacheKey, cat, items);
    if (renderKey === _lastRenderKey) return;
    _lastRenderKey = renderKey;

    container.innerHTML = items.map((item, idx) => `
        <div class="guide-card" data-guide-idx="${idx}" data-guide-name="${esc(item.name)}">
            <img class="guide-img" src="${item.image || 'https://picsum.photos/400/200?random=' + idx}" alt="${esc(item.name)}" loading="lazy" decoding="async">
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
        </div>
    `).join('');

    container.querySelectorAll('.guide-card').forEach(card => {
        card.addEventListener('click', () => {
            const idx = parseInt(card.getAttribute('data-guide-idx'), 10);
            openGuideDetail(items[idx]);
        });
    });
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
    }

    const cached = _getDisplayItems(cacheKey, currentGuideCat);
    if (!force && cached !== null) {
        renderGuideGrid(cached, { cacheKey, cat: currentGuideCat });
        _kickPrefetch(cacheKey);
        return;
    }

    const cache = _ensureCache(cacheKey);
    const gen = cache.gen;
    const needed = (currentGuideCat === 'all' ? _getPriorityCategories() : [currentGuideCat])
        .filter(cat => cache.cats[cat] === undefined);

    if (needed.length > 0) {
        if (container && cached === null) {
            container.innerHTML = '<div class="guide-loading">加载中...</div>';
        }
        await Promise.all(needed.map(cat => _loadCategory(cacheKey, cat, gen)));
    }

    const items = _getDisplayItems(cacheKey, currentGuideCat);
    if (items !== null) {
        renderGuideGrid(items, { cacheKey, cat: currentGuideCat });
    } else if (container) {
        _lastRenderKey = '';
        container.innerHTML = '<div class="guide-loading">该分类暂无推荐～</div>';
    }

    _kickPrefetch(cacheKey);
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

export async function loadGuideData() {
    initGuideModals();
    initGuideFilter();
    initGuideCampusFilter();
    bindRefreshButton();
    try {
        await _loadGuideConfig();
        await _applyGuideFilters();
    } catch (err) {
        console.error('吃喝玩乐配置加载失败:', err);
        showToast('加载失败，请稍后重试');
    }
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
