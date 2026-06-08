import { searchPlaces } from '../api.js';
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
let _guideCache = {};
let _isRefreshing = false;
let _randomOrder = false;   // 随机排序标志

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
}

// ── 渲染 ──
function renderGuideGrid(items) {
    const container = document.getElementById('guideGrid');
    if (!container) return;

    if (!items || items.length === 0) {
        container.innerHTML = '<div class="guide-loading">该分类暂无推荐～</div>';
        return;
    }

    container.innerHTML = items.map((item, idx) => `
        <div class="guide-card" data-guide-idx="${idx}">
            <img class="guide-img" src="${item.image || 'https://picsum.photos/400/200?random=' + idx}" alt="${esc(item.name)}" loading="lazy">
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
            const idx = parseInt(card.getAttribute('data-guide-idx'));
            openGuideDetail(items[idx]);
        });
    });
}

// ── 数据获取（按校区缓存） ──
async function _fetchCampusData(campus) {
    if (_guideCache[campus]) return _guideCache[campus];

    const location = _getCampusLocation(campus);
    const allItems = [];

    const promises = Object.entries(CATEGORY_CONFIG).map(async ([cat, cfg]) => {
        try {
            const r = await searchPlaces(cfg.keyword, '南京', location, 1, 10, SEARCH_RADIUS, cfg.types, 'weight');
            if (r.status === '1' && Array.isArray(r.pois)) {
                r.pois.forEach(poi => {
                    allItems.push({
                        name: poi.name,
                        desc: poi.address || '',
                        image: poi.photos?.[0]?.url || '',
                        type: cat,
                        campus: campus,
                        rating: poi.biz_ext?.rating || '',
                        price: poi.biz_ext?.cost ? `¥${poi.biz_ext.cost}/人` : '',
                        address: poi.address || '',
                    });
                });
            }
        } catch (e) {
            console.warn(`高德搜索 ${cat}（${campus}）失败:`, e.message);
        }
    });

    await Promise.all(promises);

    const seen = new Set();
    const deduped = allItems.filter(item => {
        if (seen.has(item.name)) return false;
        seen.add(item.name);
        return true;
    });

    // 根据随机标志决定排序方式
    if (_randomOrder) {
        // Fisher-Yates 随机打乱
        for (let i = deduped.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deduped[i], deduped[j]] = [deduped[j], deduped[i]];
        }
    } else {
        deduped.sort((a, b) => {
            const ra = parseFloat(a.rating) || 0;
            const rb = parseFloat(b.rating) || 0;
            return rb - ra;
        });
    }

    _guideCache[campus] = deduped;
    return deduped;
}

// ── 筛选与应用 ──
async function _applyGuideFilters(force = false) {
    const container = document.getElementById('guideGrid');
    const campus = _resolveCampus();

    if (!force && _guideCache[campus]) {
        let items = _guideCache[campus];
        if (currentGuideCat !== 'all') {
            items = items.filter(s => s.type === currentGuideCat);
        }
        renderGuideGrid(items);
        return;
    }

    if (container) container.innerHTML = '<div class="guide-loading">加载中...</div>';

    try {
        const allItems = await _fetchCampusData(campus);
        let items = allItems;
        if (currentGuideCat !== 'all') {
            items = items.filter(s => s.type === currentGuideCat);
        }
        renderGuideGrid(items);
    } catch (e) {
        console.error('指南数据加载失败:', e);
        if (container) container.innerHTML = '<div class="guide-loading">加载失败，请稍后重试</div>';
    }
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
        _randomOrder = true;           // 开启随机模式
        _clearGuideCache();            // 清除所有缓存
        await _applyGuideFilters();
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
    _randomOrder = false;   // 切换分类后恢复按评分排序
    document.querySelectorAll('#guideFilter .guide-chip').forEach(chip => {
        chip.classList.toggle('active', chip.getAttribute('data-guide-cat') === cat);
    });
    _applyGuideFilters();
}

function _filterGuideCampus(campus) {
    currentGuideCampus = campus;
    _randomOrder = false;   // 切换校区后恢复按评分排序
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
    if (container && !container.querySelector('.guide-card') && !_guideCache[campus]) {
        container.innerHTML = '<div class="guide-loading">加载精彩推荐中...</div>';
    }
    loadGuideData();
}

function esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}