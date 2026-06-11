import { API_BASE } from '../config.js';
import { getUser } from '../auth.js';
import { showToast } from '../utils.js';

// ── 校区坐标（WGS-84） ──
const CAMPUS_COORDS = {
    '鼓楼': [118.780, 32.058],
    '仙林': [118.954, 32.114],
    '浦口': [118.652, 32.157],
    '苏州': [120.39, 31.36],
};
const DEFAULT_CAMPUS = '鼓楼';

// ── 分类配置
const CATEGORY_CONFIG = {
    '美食':     { types: '050000',                          keyword: '' },
    '咖啡饮品': { types: '050500|050600|050700|050900',      keyword: '' },
    '休闲娱乐': { types: '080300|080600',                    keyword: '' },
    '运动健身': { types: '080100',                          keyword: '' },
    '购物商圈': { types: '060100|061000',                    keyword: '' },
    '景点公园': { types: '110000|140000',                    keyword: '' },
};
const SEARCH_RADIUS = 5000;

let currentGuideCat = 'all';
let currentGuideCampus = 'all';
/** @type {Record<string, { cats: Record<string, object[]>, gen: number, prefetching?: boolean, _inflight?: Record<string, Promise<object[]>> }>} */
let _guideCache = {};
let _isRefreshing = false;
let _randomOrder = false;   // 随机排序标志
const CATEGORY_NAMES = Object.keys(CATEGORY_CONFIG);
let _lastRenderKey = '';

// ── 工具 ──
function _getCampusLocation(campus) {
    const coords = CAMPUS_COORDS[campus] || CAMPUS_COORDS[DEFAULT_CAMPUS];
    return `${coords[0]},${coords[1]}`;
}

function _resolveCampus() {
    if (currentGuideCampus !== 'all') return currentGuideCampus;
    const user = getUser();
    const c = user?.campus || '';
    if (CAMPUS_COORDS[c]) return c;
    return DEFAULT_CAMPUS;
}

function _clearGuideCache() {
    _guideCache = {};
    _lastRenderKey = '';
}

function _renderKey(campus, cat, items) {
    const names = (items || []).map(i => `${i.name}:${i.type}`).join('\0');
    return `${campus}\x1f${cat}\x1f${names}`;
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

function _isPrefetchComplete(campus) {
    const cache = _guideCache[campus];
    if (!cache) return true;
    return CATEGORY_NAMES.every(cat => cache.cats[cat] !== undefined);
}

function _ensureCampusCache(campus) {
    if (!_guideCache[campus]) {
        _guideCache[campus] = { cats: {}, gen: 0 };
    }
    return _guideCache[campus];
}

function _sortAndDedupe(allItems) {
    const seen = new Set();
    const deduped = allItems.filter(item => {
        if (seen.has(item.name)) return false;
        seen.add(item.name);
        return true;
    });

    if (_randomOrder) {
        for (let i = deduped.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deduped[i], deduped[j]] = [deduped[j], deduped[i]];
        }
        return deduped;
    }

    deduped.sort((a, b) => {
        const ra = parseFloat(a.rating) || 0;
        const rb = parseFloat(b.rating) || 0;
        return rb - ra;
    });
    return deduped;
}

function _getDisplayItems(campus, cat) {
    const cache = _guideCache[campus];
    if (!cache) return null;

    if (cat !== 'all') {
        return cache.cats[cat] !== undefined ? cache.cats[cat] : null;
    }

    const merged = [];
    let anyLoaded = false;
    for (const name of CATEGORY_NAMES) {
        if (cache.cats[name] !== undefined) {
            anyLoaded = true;
            merged.push(...cache.cats[name]);
        }
    }
    return anyLoaded ? _sortAndDedupe(merged) : null;
}

function _getPriorityCategories() {
    if (currentGuideCat !== 'all') return [currentGuideCat];
    // 「全部」先拉美食（1 次请求），首屏更快
    return ['美食'];
}

function _poisToItems(pois, cat, campus) {
    if (!Array.isArray(pois)) return [];
    return pois.map(poi => ({
        name: poi.name,
        desc: poi.address || '',
        image: poi.photos?.[0]?.url || '',
        type: cat,
        campus,
        rating: poi.biz_ext?.rating || '',
        price: poi.biz_ext?.cost ? `¥${poi.biz_ext.cost}/人` : '',
        address: poi.address || '',
    }));
}

async function _fetchCategoryItems(campus, cat) {
    const cfg = CATEGORY_CONFIG[cat];
    const location = _getCampusLocation(campus);
    const r = await _searchPlacesQuiet(cfg.keyword, '南京', location, 1, 10, SEARCH_RADIUS, cfg.types, 'weight');
    if (r.status === '1' && Array.isArray(r.pois)) {
        return _poisToItems(r.pois, cat, campus);
    }
    return [];
}

async function _loadCampusBundle(campus, gen) {
    const cache = _ensureCampusCache(campus);
    if (cache.gen !== gen) return;
    if (_isPrefetchComplete(campus)) return;
    if (cache._bundleInflight) return cache._bundleInflight;

    cache._bundleInflight = (async () => {
        try {
            const url = `${API_BASE}/places/guide-bundle?campus=${encodeURIComponent(campus)}`;
            const res = await fetch(url);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || `请求失败: ${res.status}`);
            if (cache.gen !== gen) return;
            for (const cat of CATEGORY_NAMES) {
                if (cache.cats[cat] !== undefined) continue;
                cache.cats[cat] = Array.isArray(data.categories?.[cat]) ? data.categories[cat] : [];
            }
        } catch (e) {
            console.warn(`guide-bundle（${campus}）失败，回退分分类请求:`, e.message);
            const todo = CATEGORY_NAMES.filter(cat => cache.cats[cat] === undefined);
            await Promise.all(todo.map(cat => _loadCategory(campus, cat, gen)));
        } finally {
            delete cache._bundleInflight;
            if (_guideCache[campus]?.gen === gen) {
                _guideCache[campus].prefetching = false;
            }
        }
    })();

    return cache._bundleInflight;
}

async function _loadCategory(campus, cat, gen) {
    const cache = _ensureCampusCache(campus);
    if (cache.cats[cat] !== undefined) return cache.cats[cat];
    if (cache.gen !== gen) return [];

    cache._inflight = cache._inflight || {};
    if (cache._inflight[cat]) return cache._inflight[cat];

    cache._inflight[cat] = (async () => {
        try {
            const items = await _fetchCategoryItems(campus, cat);
            if (cache.gen === gen) cache.cats[cat] = items;
            return items;
        } catch (e) {
            console.warn(`高德搜索 ${cat}（${campus}）失败:`, e.message);
            if (cache.gen === gen) cache.cats[cat] = [];
            return [];
        } finally {
            delete cache._inflight[cat];
        }
    })();

    return cache._inflight[cat];
}

function _maybeRender(campus, gen, { force = false } = {}) {
    if (_resolveCampus() !== campus) return;
    const cache = _guideCache[campus];
    if (!cache || cache.gen !== gen) return;

    const items = _getDisplayItems(campus, currentGuideCat);
    if (items === null) return;

    const key = _renderKey(campus, currentGuideCat, items);
    if (!force && key === _lastRenderKey) return;

    renderGuideGrid(items, { campus, cat: currentGuideCat, renderKey: key });

    if (_isPrefetchComplete(campus)) {
        _setPrefetchHint(false);
    }
}

function _kickPrefetch(campus) {
    const cache = _guideCache[campus];
    if (!cache || cache.prefetching || cache._bundleInflight) return;
    if (_isPrefetchComplete(campus)) return;

    const gen = cache.gen;
    cache.prefetching = true;
    if (currentGuideCat === 'all' && _resolveCampus() === campus) {
        _setPrefetchHint(true);
    }
    (async () => {
        await _loadCampusBundle(campus, gen);
        if (_guideCache[campus]?.gen === gen) {
            if (currentGuideCat === 'all' && _resolveCampus() === campus) {
                _maybeRender(campus, gen, { force: true });
            } else {
                _setPrefetchHint(false);
            }
        }
    })();
}
/** 吃喝玩乐批量拉取专用：失败时不弹全局 toast（避免 6 路并行请求刷屏） */
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

// ── 渲染 ──
function renderGuideGrid(items, meta = {}) {
    const container = document.getElementById('guideGrid');
    if (!container) return;

    if (!items || items.length === 0) {
        _lastRenderKey = '';
        container.innerHTML = '<div class="guide-loading">该分类暂无推荐～</div>';
        return;
    }

    const campus = meta.campus ?? _resolveCampus();
    const cat = meta.cat ?? currentGuideCat;
    const renderKey = meta.renderKey ?? _renderKey(campus, cat, items);
    if (renderKey === _lastRenderKey) return;
    _lastRenderKey = renderKey;

    container.innerHTML = items.map((item, idx) => `
        <div class="guide-card" data-guide-idx="${idx}" data-guide-name="${esc(item.name)}">
            <img class="guide-img" src="${item.image || 'https://picsum.photos/400/200?random=' + idx}" alt="${esc(item.name)}" loading="lazy" decoding="async">
            <div class="guide-info">
                <div class="guide-title">
                    ${esc(item.name)}
                    ${item.rating ? `<span class="guide-rating"><i class="fas fa-star" aria-hidden="true"></i> ${item.rating}</span>` : ''}
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

// ── 筛选与应用 ──
async function _applyGuideFilters(force = false) {
    const container = document.getElementById('guideGrid');
    const campus = _resolveCampus();

    if (force) {
        const c = _ensureCampusCache(campus);
        c.gen += 1;
        c.cats = {};
        c._inflight = {};
        c._bundleInflight = null;
        c.prefetching = false;
        _lastRenderKey = '';
        _setPrefetchHint(false);
    }

    const cached = _getDisplayItems(campus, currentGuideCat);
    if (!force && cached !== null) {
        renderGuideGrid(cached, { campus, cat: currentGuideCat });
        _kickPrefetch(campus);
        return;
    }

    const cache = _ensureCampusCache(campus);
    const gen = cache.gen;
    const needed = (currentGuideCat === 'all' ? _getPriorityCategories() : [currentGuideCat])
        .filter(cat => cache.cats[cat] === undefined);

    if (needed.length > 0) {
        if (container && cached === null) {
            container.innerHTML = '<div class="guide-loading">加载中...</div>';
        }
        await Promise.all(needed.map(cat => _loadCategory(campus, cat, gen)));
    }

    const items = _getDisplayItems(campus, currentGuideCat);
    if (items !== null) {
        renderGuideGrid(items, { campus, cat: currentGuideCat });
    } else if (container) {
        _lastRenderKey = '';
        container.innerHTML = '<div class="guide-loading">该分类暂无推荐～</div>';
    }

    _kickPrefetch(campus);
}

// 刷新数据（清除缓存 + 随机排序）
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

// ── 详情弹窗 ──
function openGuideDetail(item) {
    const modal = document.getElementById('guideDetailModal');
    if (!modal) return;
    document.getElementById('guideDetailImg').src = item.image || '';
    document.getElementById('guideDetailName').textContent = item.name;
    document.getElementById('guideDetailRating').innerHTML = item.rating ? `<i class="fas fa-star" aria-hidden="true"></i> ${esc(String(item.rating))}` : '';
    document.getElementById('guideDetailPrice').textContent = item.price || '';
    document.getElementById('guideDetailPrice').style.cssText = item.price ? 'font-weight:700;color:var(--danger);' : '';
    document.getElementById('guideDetailType').textContent = item.type || '';
    document.getElementById('guideDetailType').style.cssText = item.type ? 'padding:3px 10px;border-radius:10px;font-size:0.75rem;background:var(--bg-tertiary);color:var(--text-secondary);' : '';
    document.getElementById('guideDetailDesc').textContent = item.desc || '';
    document.getElementById('guideDetailAddr').innerHTML = item.address ? `<i class="fas fa-location-dot" aria-hidden="true"></i> ${esc(item.address)}` : '';
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

// ── 筛选栏初始化 ──
function initGuideFilter() {
    const filterBar = document.getElementById('guideFilter');
    if (!filterBar || filterBar.dataset.ready) return;
    filterBar.dataset.ready = '1';
    filterBar.querySelectorAll('.guide-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const cat = chip.getAttribute('data-guide-cat');
            filterGuideItems(cat);
        });
    });
}

function initGuideCampusFilter() {
    const filterBar = document.getElementById('guideCampusFilter');
    if (!filterBar || filterBar.dataset.ready) return;
    filterBar.dataset.ready = '1';

    const user = getUser();
    const userCampus = user?.campus || '';
    if (userCampus && ['鼓楼', '仙林', '浦口', '苏州'].includes(userCampus)) {
        currentGuideCampus = userCampus;
        document.querySelectorAll('#guideCampusFilter .guide-chip').forEach(chip => {
            chip.classList.toggle('active', chip.getAttribute('data-guide-campus') === userCampus);
        });
    }

    filterBar.querySelectorAll('.guide-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const campus = chip.getAttribute('data-guide-campus');
            _filterGuideCampus(campus);
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

// ── 入口 ──
export async function loadGuideData() {
    initGuideModals();
    initGuideFilter();
    initGuideCampusFilter();
    bindRefreshButton();
    _applyGuideFilters();
}

export function initGuidePage() {
    const container = document.getElementById('guideGrid');
    const campus = _resolveCampus();
    const hasData = _getDisplayItems(campus, currentGuideCat);
    if (container && !container.querySelector('.guide-card') && hasData === null) {
        container.innerHTML = '<div class="guide-loading">加载精彩推荐中...</div>';
    }
    loadGuideData();
}

function esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}