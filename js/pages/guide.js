import { API_BASE } from '../config.js';
import {
    ensureGuidePlace,
    getGuideLeaderboard,
    searchPlaces,
    togglePlaceLike,
} from '../api.js';
import { getUser, isLoggedIn } from '../auth.js';
import { showToast } from '../utils.js';

const DEFAULT_CAMPUS = '鼓楼';
const ALL_CAMPUSES = ['鼓楼', '仙林', '浦口', '苏州'];
const GUIDE_IMG_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='200' fill='%23e8e4f0'/%3E";
const GUIDE_CACHE_TTL_MS = 3 * 60 * 1000;

let _guideConfig = null;
let currentGuideCat = '美食';
let currentGuideCampus = DEFAULT_CAMPUS;
let _guideRenderItems = [];
let _guideDataLoadedAt = 0;
let _leaderboardCache = {};
let _isRefreshing = false;
let _detailItem = null;
let _explorePage = 1;

function esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _secureImageUrl(url) {
    if (!url) return '';
    return String(url).replace(/^http:\/\//i, 'https://');
}

function _categoryNames() {
    return _guideConfig ? Object.keys(_guideConfig.categories) : [];
}

function _searchCity(campus) {
    return campus === '苏州' ? '苏州' : '南京';
}

function _getCampusLocation(campus) {
    const coords = _guideConfig?.campuses?.[campus];
    return coords || _guideConfig?.campuses?.[DEFAULT_CAMPUS] || '118.780,32.058';
}

function _categoryTypes(cat) {
    return _guideConfig?.categories?.[cat]?.types || '';
}

async function _loadGuideConfig() {
    if (_guideConfig) return _guideConfig;
    const res = await fetch(`${API_BASE}/places/guide-config`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `配置加载失败: ${res.status}`);
    _guideConfig = data;
    return _guideConfig;
}

function _cacheKey(campus, cat) {
    return `${campus}\x1f${cat}`;
}

function _topRankBadge(rank) {
    if (rank === 1) {
        return '<div class="guide-top-badge guide-top-badge--1"><i class="fas fa-crown" aria-hidden="true"></i><span>TOP 1</span></div>';
    }
    if (rank === 2) {
        return '<div class="guide-top-badge guide-top-badge--2"><span>TOP 2</span></div>';
    }
    if (rank === 3) {
        return '<div class="guide-top-badge guide-top-badge--3"><span>TOP 3</span></div>';
    }
    return '';
}

function _guideCardHtml(item, idx) {
    const likes = item.like_count || 0;
    const reviews = item.review_count || 0;
    const rank = item.rank || (idx + 1);
    const dist = item.distance_label || (item.distance_m != null ? `${item.distance_m}m` : '');
    const topClass = rank <= 3 ? ` guide-waterfall-card--top${rank}` : '';
    const imgSrc = _secureImageUrl(item.image) || GUIDE_IMG_PLACEHOLDER;

    return `
        <article class="guide-waterfall-card${topClass}" data-guide-idx="${idx}" data-guide-name="${esc(item.name)}">
            ${_topRankBadge(rank)}
            <div class="guide-card-cover">
                <img class="guide-card-cover-img" src="${imgSrc}" alt="${esc(item.name)}" loading="lazy" decoding="async">
            </div>
            <div class="guide-card-body">
                <h3 class="guide-card-name">${esc(item.name)}</h3>
                <div class="guide-card-stats">
                    <span class="guide-stat guide-stat--likes" title="点赞数">
                        <i class="fas fa-heart" aria-hidden="true"></i> ${likes} 赞
                    </span>
                    ${item.rating ? `<span class="guide-stat guide-stat--rating" title="评分"><i class="fas fa-star" aria-hidden="true"></i> ${esc(String(item.rating))}</span>` : ''}
                    ${reviews ? `<span class="guide-stat guide-stat--reviews" title="评论数"><i class="fas fa-comment" aria-hidden="true"></i> ${reviews}</span>` : ''}
                    ${dist ? `<span class="guide-stat guide-stat--dist" title="距校区"><i class="fas fa-route" aria-hidden="true"></i> ${esc(dist)}</span>` : ''}
                </div>
                <p class="guide-card-addr">${esc(item.address || item.desc || '暂无地址')}</p>
                <div class="guide-card-tags">
                    ${item.campus ? `<span class="guide-tag guide-tag--campus"><i class="fas fa-location-dot" aria-hidden="true"></i> ${esc(item.campus)}</span>` : ''}
                    ${item.type ? `<span class="guide-tag guide-tag--type">${esc(item.type)}</span>` : ''}
                    ${item.price ? `<span class="guide-tag guide-tag--price">${esc(item.price)}</span>` : ''}
                </div>
                <button type="button" class="guide-card-like-btn ${item.liked ? 'is-liked' : ''}" data-like-idx="${idx}" aria-label="点赞">
                    <i class="fas fa-heart" aria-hidden="true"></i>
                    <span>${item.liked ? '已点赞' : '点赞支持'}</span>
                </button>
            </div>
        </article>`;
}

function _sectionHtml(title, items, offset = 0) {
    const cards = items.map((item, i) => _guideCardHtml(item, offset + i)).join('');
    return `<section class="guide-campus-section"><h3 class="guide-section-title">${esc(title)}</h3><div class="guide-waterfall guide-section-waterfall">${cards}</div></section>`;
}

function _bindGuideGridDelegation(container) {
    if (container.dataset.guideBound === 'true') return;
    container.dataset.guideBound = 'true';
    container.addEventListener('click', async (e) => {
        const likeBtn = e.target.closest('.guide-card-like-btn[data-like-idx]');
        if (likeBtn) {
            e.stopPropagation();
            const idx = parseInt(likeBtn.getAttribute('data-like-idx'), 10);
            if (!Number.isNaN(idx) && _guideRenderItems[idx]) {
                await handleGuideLike(_guideRenderItems[idx], likeBtn);
            }
            return;
        }
        const card = e.target.closest('.guide-waterfall-card');
        if (!card) return;
        const idx = parseInt(card.getAttribute('data-guide-idx'), 10);
        if (!Number.isNaN(idx) && _guideRenderItems[idx]) {
            openGuideDetail(_guideRenderItems[idx]);
        }
    });
}

function renderLeaderboard(payload) {
    const container = document.getElementById('guideGrid');
    if (!container) return;

    let html = '';
    let flat = [];

    if (payload.sections) {
        let offset = 0;
        for (const section of payload.sections) {
            const items = section.items || [];
            if (!items.length) continue;
            html += _sectionHtml(`${section.campus} · ${payload.category}`, items, offset);
            flat = flat.concat(items);
            offset += items.length;
        }
    } else {
        const items = payload.items || [];
        flat = items;
        if (!items.length) {
            container.innerHTML = '<div class="guide-empty">暂无上榜店铺，去探索页点赞推荐吧～</div>';
            _guideRenderItems = [];
            return;
        }
        html = items.map((item, idx) => _guideCardHtml(item, idx)).join('');
    }

    if (!flat.length) {
        container.innerHTML = '<div class="guide-empty">暂无上榜店铺，去探索页点赞推荐吧～</div>';
        _guideRenderItems = [];
        return;
    }

    _guideRenderItems = flat;
    container.innerHTML = html;
    _bindGuideGridDelegation(container);
}

async function loadLeaderboard({ force = false, shuffle = false } = {}) {
    const campus = currentGuideCampus;
    const cat = currentGuideCat;
    const key = _cacheKey(campus, cat);
    const container = document.getElementById('guideGrid');

    if (!force && !shuffle && _leaderboardCache[key] && (Date.now() - _guideDataLoadedAt) < GUIDE_CACHE_TTL_MS) {
        renderLeaderboard(_leaderboardCache[key]);
        return;
    }

    if (container) container.innerHTML = '<div class="guide-loading">加载排行榜…</div>';

    try {
        await _loadGuideConfig();
        const data = await getGuideLeaderboard(campus, cat, { shuffle });
        _leaderboardCache[key] = data;
        _guideDataLoadedAt = Date.now();
        renderLeaderboard(data);
    } catch (err) {
        console.error('排行榜加载失败:', err);
        if (container) container.innerHTML = '<div class="guide-empty">加载失败，请稍后重试</div>';
        showToast('排行榜加载失败');
    }
}

async function handleGuideLike(item, btnEl) {
    if (!isLoggedIn()) {
        document.getElementById('authModal').style.display = 'flex';
        return;
    }
    const campus = item.campus || (currentGuideCampus === 'all' ? DEFAULT_CAMPUS : currentGuideCampus);
    try {
        btnEl.disabled = true;
        const ensured = await ensureGuidePlace({
            campus,
            category: item.type || currentGuideCat,
            item,
        });
        const wasLiked = Boolean(item.liked);
        const result = await togglePlaceLike(ensured.place_id);
        let likes = ensured.likes ?? item.like_count ?? 0;
        if (result.liked && !wasLiked) likes += 1;
        if (!result.liked && wasLiked) likes = Math.max(0, likes - 1);
        item.place_id = ensured.place_id;
        item.liked = result.liked;
        item.like_count = likes;
        btnEl.classList.toggle('is-liked', result.liked);
        const label = btnEl.querySelector('span');
        if (label) label.textContent = result.liked ? '已点赞' : '点赞支持';
        const card = btnEl.closest('.guide-waterfall-card');
        const likesStat = card?.querySelector('.guide-stat--likes');
        if (likesStat) likesStat.innerHTML = `<i class="fas fa-heart" aria-hidden="true"></i> ${likes} 赞`;
        if (_detailItem && _detailItem.poi_id === item.poi_id) {
            _detailItem = { ...item };
            _syncDetailLikeBtn();
        }
        showToast(result.liked ? '点赞成功，感谢推荐！' : '已取消点赞');
        delete _leaderboardCache[_cacheKey(currentGuideCampus, currentGuideCat)];
    } catch (err) {
        if (err.message !== 'UNAUTHORIZED') showToast(err.message || '点赞失败');
    } finally {
        btnEl.disabled = false;
    }
}

function _syncDetailLikeBtn() {
    const btn = document.getElementById('guideDetailLikeBtn');
    const likesEl = document.getElementById('guideDetailLikes');
    if (!_detailItem || !btn) return;
    btn.classList.toggle('is-liked', Boolean(_detailItem.liked));
    const likes = _detailItem.like_count || 0;
    document.getElementById('guideDetailLikeText').textContent = _detailItem.liked ? '已点赞' : '点赞';
    if (likesEl) likesEl.innerHTML = likes ? `<i class="fas fa-heart"></i> ${likes}` : '';
}

function openGuideDetail(item) {
    _detailItem = { ...item };
    const modal = document.getElementById('guideDetailModal');
    if (!modal) return;
    document.getElementById('guideDetailImg').src = _secureImageUrl(item.image) || GUIDE_IMG_PLACEHOLDER;
    document.getElementById('guideDetailName').textContent = item.name || '';
    document.getElementById('guideDetailRating').innerHTML = item.rating
        ? `<i class="fas fa-star" aria-hidden="true"></i> ${esc(String(item.rating))}`
        : '';
    document.getElementById('guideDetailPrice').textContent = item.price || '';
    document.getElementById('guideDetailType').textContent = item.type || '';
    document.getElementById('guideDetailDesc').textContent = item.address || item.desc || '';
    document.getElementById('guideDetailAddr').innerHTML = item.distance_label
        ? `<i class="fas fa-route" aria-hidden="true"></i> 距校区约 ${esc(item.distance_label)}`
        : '';
    _syncDetailLikeBtn();
    modal.style.display = 'flex';
}

function openGuideExplore() {
    const modal = document.getElementById('guideExploreModal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.getElementById('guideExploreInput')?.focus();
}

function closeGuideExplore() {
    const modal = document.getElementById('guideExploreModal');
    if (modal) modal.style.display = 'none';
}

function _exploreItemFromPoi(poi, cat) {
    const biz = poi.biz_ext || {};
    const cost = biz.cost;
    const campus = currentGuideCampus === 'all' ? DEFAULT_CAMPUS : currentGuideCampus;
    return {
        poi_id: String(poi.id || '').trim(),
        name: poi.name || '',
        address: poi.address || '',
        desc: poi.address || '',
        image: _secureImageUrl(poi.photos?.[0]?.url || ''),
        type: cat,
        campus,
        rating: biz.rating || '',
        price: cost ? `¥${cost}/人` : '',
        location: poi.location || '',
        distance_m: poi.distance ? parseInt(poi.distance, 10) : null,
        distance_label: poi.distance ? `${poi.distance}m` : '',
    };
}

function _exploreResultHtml(item, idx) {
    return `
        <div class="guide-explore-item" data-explore-idx="${idx}">
            <div class="guide-explore-main">
                <div class="guide-explore-name">${esc(item.name)}</div>
                <div class="guide-explore-addr">${esc(item.address || '')}</div>
                <div class="guide-explore-meta">
                    ${item.distance_label ? `<span>${esc(item.distance_label)}</span>` : ''}
                    ${item.rating ? `<span><i class="fas fa-star"></i> ${esc(String(item.rating))}</span>` : ''}
                </div>
            </div>
            <button type="button" class="guide-explore-like" data-explore-like="${idx}"><i class="fas fa-heart"></i> 点赞</button>
        </div>`;
}

let _exploreItems = [];

async function runGuideExploreSearch(page = 1) {
    const input = document.getElementById('guideExploreInput');
    const results = document.getElementById('guideExploreResults');
    if (!results) return;

    const keyword = (input?.value || '').trim();
    const campus = currentGuideCampus === 'all' ? DEFAULT_CAMPUS : currentGuideCampus;
    const cat = currentGuideCat;
    const location = _getCampusLocation(campus);
    const city = _searchCity(campus);
    const types = _categoryTypes(cat);

    results.innerHTML = '<div class="guide-loading">搜索中…</div>';
    _explorePage = page;

    try {
        await _loadGuideConfig();
        const data = await searchPlaces(
            keyword,
            city,
            location,
            page,
            20,
            _guideConfig.search_radius,
            types,
            'distance',
        );
        if (data.status !== '1' || !Array.isArray(data.pois) || !data.pois.length) {
            results.innerHTML = '<div class="guide-empty">未找到相关店铺，换个关键词试试</div>';
            _exploreItems = [];
            return;
        }
        _exploreItems = data.pois.map((poi) => _exploreItemFromPoi(poi, cat));
        results.innerHTML = _exploreItems.map((item, idx) => _exploreResultHtml(item, idx)).join('');
        results.querySelectorAll('[data-explore-like]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-explore-like'), 10);
                if (!Number.isNaN(idx) && _exploreItems[idx]) {
                    await handleGuideLike(_exploreItems[idx], btn);
                }
            });
        });
    } catch (err) {
        console.error(err);
        results.innerHTML = '<div class="guide-empty">搜索失败，请稍后重试</div>';
    }
}

export async function refreshGuideData() {
    if (_isRefreshing) {
        showToast('刷新中，请稍候…');
        return;
    }
    const btn = document.getElementById('refreshGuideBtn');
    try {
        _isRefreshing = true;
        btn?.classList.add('refreshing');
        if (btn) btn.disabled = true;
        _leaderboardCache = {};
        await loadLeaderboard({ force: true, shuffle: true });
        showToast('排行榜已刷新');
    } catch {
        showToast('刷新失败');
    } finally {
        _isRefreshing = false;
        btn?.classList.remove('refreshing');
        if (btn) btn.disabled = false;
    }
}

function filterGuideCategory(cat) {
    currentGuideCat = cat;
    document.querySelectorAll('#guideFilter .guide-chip').forEach((chip) => {
        chip.classList.toggle('active', chip.getAttribute('data-guide-cat') === cat);
    });
    loadLeaderboard({ force: true });
}

function filterGuideCampus(campus) {
    currentGuideCampus = campus;
    document.querySelectorAll('#guideCampusFilter .guide-chip').forEach((chip) => {
        chip.classList.toggle('active', chip.getAttribute('data-guide-campus') === campus);
    });
    loadLeaderboard({ force: true });
}

function initGuideModals() {
    const detailModal = document.getElementById('guideDetailModal');
    if (detailModal && !detailModal.dataset.ready) {
        detailModal.dataset.ready = '1';
        document.getElementById('closeGuideDetailBtn')?.addEventListener('click', () => {
            detailModal.style.display = 'none';
        });
        detailModal.addEventListener('click', (e) => {
            if (e.target === detailModal) detailModal.style.display = 'none';
        });
        document.getElementById('guideDetailLikeBtn')?.addEventListener('click', async () => {
            if (_detailItem) {
                await handleGuideLike(_detailItem, document.getElementById('guideDetailLikeBtn'));
            }
        });
    }

    const exploreModal = document.getElementById('guideExploreModal');
    if (exploreModal && !exploreModal.dataset.ready) {
        exploreModal.dataset.ready = '1';
        document.getElementById('closeGuideExploreBtn')?.addEventListener('click', closeGuideExplore);
        exploreModal.addEventListener('click', (e) => {
            if (e.target === exploreModal) closeGuideExplore();
        });
        document.getElementById('openGuideExploreBtn')?.addEventListener('click', openGuideExplore);
        document.getElementById('guideExploreSearchBtn')?.addEventListener('click', () => runGuideExploreSearch(1));
        document.getElementById('guideExploreInput')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') runGuideExploreSearch(1);
        });
    }
}

function initGuideFilter() {
    const filterBar = document.getElementById('guideFilter');
    if (!filterBar || filterBar.dataset.ready) return;
    filterBar.dataset.ready = '1';
    filterBar.querySelectorAll('.guide-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            filterGuideCategory(chip.getAttribute('data-guide-cat'));
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
        document.querySelectorAll('#guideCampusFilter .guide-chip').forEach((chip) => {
            const c = chip.getAttribute('data-guide-campus');
            chip.classList.toggle('active', c === userCampus);
            if (c === 'all') chip.classList.remove('active');
        });
    }

    filterBar.querySelectorAll('.guide-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            filterGuideCampus(chip.getAttribute('data-guide-campus'));
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
    await loadLeaderboard();
}

export function refreshGuideView() {
    loadLeaderboard();
}

export function onGuidePageHidden() {
    /* no background work */
}

export function prefetchGuideData() {
    return _loadGuideConfig().catch(() => {});
}

export function initGuidePage() {
    const container = document.getElementById('guideGrid');
    if (container && !container.querySelector('.guide-waterfall-card')) {
        container.innerHTML = '<div class="guide-loading">加载排行榜…</div>';
    }
    loadGuideData();
}
