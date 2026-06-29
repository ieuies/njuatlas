import { API_BASE } from '../config.js';
import {
    flushGuideLikeQueue,
    hasPendingGuideLikes,
    overlayGuideLikeStateOnItems,
    recordGuideLikeSyncResult,
    refreshUserGuideLikes,
    resetGuideLikeSync,
    seedGuideLikeSyncFromItems,
} from '../guide-like-sync.js';
import { getUser, isLoggedIn } from '../auth.js';
import { showToast } from '../utils.js';
import {
    getGuideLeaderboard,
    getPlaceSuggestions,
    getGuideLikeKey,
    resolveGuidePlaceId,
    searchGuidePlaces,
    syncGuideLikeToServer,
} from '../api.js';
import {
    hydrateAllLeaderboardsFromStorage,
    scheduleGuideBackgroundPrefetch,
    prefetchGuideLeaderboard,
    isGuidePrefetchComplete,
} from '../guide-prefetch.js';
import {
    ALL_GUIDE_CAMPUSES,
    entryCacheKey,
    GUIDE_CACHE_TTL_MS,
    GUIDE_LB_CACHE_KEY,
    GUIDE_LAZY_IMAGE_EAGER_COUNT,
    invalidateLeaderboardCacheKeys,
    leaderboardKeysForGuideItem,
    persistLeaderboardToStorage,
    readLeaderboardRow,
    readWarmLeaderboard,
    stripGuideUserState,
    stripGuideUserStateFromStorageCache,
} from '../guide-warm-cache.js';

const DEFAULT_CAMPUS = '鼓楼';
const ALL_CAMPUSES = ALL_GUIDE_CAMPUSES.filter((c) => c !== 'all');
const GUIDE_IMG_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='200' fill='%23e8e4f0'/%3E";

let _guideConfig = null;
let currentGuideCat = '美食';
let currentGuideCampus = DEFAULT_CAMPUS;
let _guideRenderItems = [];
let _leaderboardCache = {};
let _leaderboardCacheAt = {};
let _loadLeaderboardSeq = 0;
hydrateAllLeaderboardsFromStorage(_leaderboardCache, _leaderboardCacheAt);
if (typeof window !== 'undefined') {
    window.addEventListener('njuatlas:guide-lb-cache', (e) => {
        const { key, data, at } = e.detail || {};
        if (!key || !data) return;
        _leaderboardCache[key] = data;
        _leaderboardCacheAt[key] = at || Date.now();
    });
    window.addEventListener('njuatlas:guide-lb-invalidate', (e) => {
        for (const key of e.detail?.keys || []) {
            delete _leaderboardCache[key];
            delete _leaderboardCacheAt[key];
        }
    });
    window.addEventListener('njuatlas:auth-change', async () => {
        if (!isLoggedIn()) resetGuideLikeSync();
        stripGuideUserStateFromStorageCache();
        for (const key of Object.keys(_leaderboardCache)) {
            _leaderboardCache[key] = stripGuideUserState(_leaderboardCache[key]);
        }
        if (document.getElementById('guidePage')?.classList.contains('active-page')) {
            refreshGuideView();
        }
    });
}
let _isRefreshing = false;
let _detailItem = null;
let _explorePage = 1;
let _guideViewMode = 'leaderboard';
let _guideSearchQuery = '';
let _guideSearchPage = 1;
let _guideSearchHasMore = false;
let _guideSearchLoading = false;
let _suggestTimer = null;
let _exploreHasMore = false;
let _exploreKeyword = '';
let _guidePageExtrasScheduled = false;
let _guideModalsReady = false;
let _guideSearchReady = false;
let _guideShellReady = false;

function esc(str) {
    if (str == null || str === '') return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

function _entryCampus() {
    return DEFAULT_CAMPUS;
}

function _syncCampusFilterUi() {
    document.querySelectorAll('#guideCampusFilter .guide-chip').forEach((chip) => {
        chip.classList.toggle('active', chip.getAttribute('data-guide-campus') === currentGuideCampus);
    });
}

function ensureGuideModals() {
    if (_guideModalsReady) return;
    _guideModalsReady = true;
    initGuideModals();
}

function ensureGuideSearchBar() {
    if (_guideSearchReady) return;
    _guideSearchReady = true;
    initGuideSearchBar();
}

function initGuideShellHandlers() {
    if (_guideShellReady) return;
    _guideShellReady = true;

    initGuideFilter();
    initGuideCampusFilter();
    bindRefreshButton();

    document.getElementById('openGuideExploreBtn')?.addEventListener('click', () => {
        ensureGuideModals();
        openGuideExplore();
    });

    const focusSearch = () => ensureGuideSearchBar();
    document.getElementById('guideSearchInput')?.addEventListener('focus', focusSearch, { once: true });
    document.getElementById('guideSearchBtn')?.addEventListener('click', focusSearch, { once: true });
}

function _scheduleGuidePageExtras() {
    if (_guidePageExtrasScheduled) return;
    _guidePageExtrasScheduled = true;

    const run = async () => {
        ensureGuideModals();
        ensureGuideSearchBar();
        await _loadGuideConfig().catch(() => {});
        if (isLoggedIn()) {
            const likeTasks = [];
            if (hasPendingGuideLikes()) likeTasks.push(flushGuideLikeQueue());
            likeTasks.push(refreshUserGuideLikes());
            await Promise.all(likeTasks).catch(() => {});
            const key = _cacheKey(currentGuideCampus, currentGuideCat);
            if (_leaderboardCache[key]) renderLeaderboard(_leaderboardCache[key], key);
        }
        scheduleGuideBackgroundPrefetch();
    };

    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => { run().catch(() => {}); }, { timeout: 2500 });
    } else {
        setTimeout(() => { run().catch(() => {}); }, 300);
    }
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
    return entryCacheKey(campus, cat);
}

function _readStaleLeaderboardData(key) {
    try {
        const map = JSON.parse(sessionStorage.getItem(GUIDE_LB_CACHE_KEY) || '{}');
        return map[key]?.data || null;
    } catch {
        return null;
    }
}

function _getCachedLeaderboard(key) {
    if (_leaderboardCache[key]) return _leaderboardCache[key];
    const row = readLeaderboardRow(key);
    if (row?.data) {
        _leaderboardCache[key] = row.data;
        _leaderboardCacheAt[key] = row.at;
        return row.data;
    }
    const warm = readWarmLeaderboard(key);
    if (warm) {
        _leaderboardCache[key] = warm;
        return warm;
    }
    const stale = _readStaleLeaderboardData(key);
    if (stale) {
        _leaderboardCache[key] = stale;
        return stale;
    }
    return null;
}

function _isCacheFresh(key) {
    const at = _leaderboardCacheAt[key];
    return at && (Date.now() - at) < GUIDE_CACHE_TTL_MS;
}

function _showGuideLoading(container) {
    if (!container) return;
    container.dataset.guideKey = '';
    _guideRenderItems = [];
    container.innerHTML = '<div class="guide-loading">加载排行榜…</div>';
}

function _rememberLeaderboard(key, data) {
    _leaderboardCache[key] = data;
    _leaderboardCacheAt[key] = Date.now();
    persistLeaderboardToStorage(key, data);
}

function _bindGuideLazyImages(container) {
    if (!container) return;
    const imgs = container.querySelectorAll('img.guide-card-cover-img[data-src]');
    if (!imgs.length) return;
    if (!('IntersectionObserver' in window)) {
        imgs.forEach((img) => {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
        });
        return;
    }
    const io = new IntersectionObserver((entries, obs) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const img = entry.target;
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
            obs.unobserve(img);
        }
    }, { rootMargin: '240px 0px' });
    imgs.forEach((img) => io.observe(img));
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

function _guideCardHtml(item, idx, { showRank = true } = {}) {
    const likes = item.like_count || 0;
    const reviews = item.review_count || 0;
    const rank = item.rank || (idx + 1);
    const dist = item.distance_label || (item.distance_m != null ? `${item.distance_m}m` : '');
    const topClass = showRank && rank <= 3 ? ` guide-waterfall-card--top${rank}` : '';
    const imgSrc = _secureImageUrl(item.image) || GUIDE_IMG_PLACEHOLDER;
    const rankBadge = showRank ? _topRankBadge(rank) : '';
    const eagerImage = idx < GUIDE_LAZY_IMAGE_EAGER_COUNT && imgSrc !== GUIDE_IMG_PLACEHOLDER;
    const imgTag = eagerImage
        ? `<img class="guide-card-cover-img" src="${imgSrc}" alt="${esc(item.name)}" loading="eager" decoding="async" fetchpriority="high">`
        : `<img class="guide-card-cover-img" src="${GUIDE_IMG_PLACEHOLDER}" data-src="${imgSrc}" alt="${esc(item.name)}" loading="lazy" decoding="async">`;

    return `
        <article class="guide-waterfall-card${topClass}" data-guide-idx="${idx}" data-guide-name="${esc(item.name)}">
            ${rankBadge}
            <div class="guide-card-cover">
                ${imgTag}
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

function _sortGuideItemsByLikes(items) {
    if (!items?.length) return items;
    const liked = [];
    const unliked = [];
    for (const item of items) {
        if ((Number(item.like_count) || 0) > 0) liked.push(item);
        else unliked.push(item);
    }
    const cmp = (a, b) => {
        const likeDiff = (Number(b.like_count) || 0) - (Number(a.like_count) || 0);
        if (likeDiff !== 0) return likeDiff;
        const reviewDiff = (Number(b.review_count) || 0) - (Number(a.review_count) || 0);
        if (reviewDiff !== 0) return reviewDiff;
        return (Number(a.rank) || 999) - (Number(b.rank) || 999);
    };
    liked.sort(cmp);
    unliked.sort(cmp);
    const sorted = liked.concat(unliked);
    sorted.forEach((item, idx) => {
        item.rank = idx + 1;
    });
    return sorted;
}

function renderLeaderboard(payload, cacheKey) {
    const container = document.getElementById('guideGrid');
    if (!container) return;

    let flat = [];
    if (payload.sections) {
        for (const section of payload.sections) {
            flat = flat.concat(section.items || []);
        }
    } else {
        flat = payload.items || [];
    }

    if (!flat.length) {
        container.innerHTML = '<div class="guide-empty">暂无上榜店铺，去探索页点赞推荐吧～</div>';
        _guideRenderItems = [];
        if (cacheKey) container.dataset.guideKey = cacheKey;
        return;
    }

    seedGuideLikeSyncFromItems(flat);
    overlayGuideLikeStateOnItems(flat);

    if (payload.sections) {
        for (const section of payload.sections) {
            if (section.items?.length) {
                section.items = _sortGuideItemsByLikes(section.items);
            }
        }
        flat = [];
        for (const section of payload.sections) {
            flat = flat.concat(section.items || []);
        }
    } else {
        flat = _sortGuideItemsByLikes(flat);
    }

    let html = '';
    if (payload.sections) {
        let offset = 0;
        for (const section of payload.sections) {
            const items = section.items || [];
            if (!items.length) continue;
            html += _sectionHtml(`${section.campus} · ${payload.category}`, items, offset);
            offset += items.length;
        }
    } else {
        html = flat.map((item, idx) => _guideCardHtml(item, idx)).join('');
    }

    _guideRenderItems = flat;
    container.innerHTML = html;
    if (cacheKey) container.dataset.guideKey = cacheKey;
    _bindGuideGridDelegation(container);
    _bindGuideLazyImages(container);
}

function _showLeaderboardFromCache(key) {
    const cached = _getCachedLeaderboard(key);
    if (!cached) return false;
    renderLeaderboard(cached, key);
    return true;
}

async function loadLeaderboard({ force = false, shuffle = false } = {}) {
    const campus = currentGuideCampus;
    const cat = currentGuideCat;
    const key = _cacheKey(campus, cat);
    const container = document.getElementById('guideGrid');
    const seq = ++_loadLeaderboardSeq;

    if (shuffle) {
        const cached = _getCachedLeaderboard(key);
        if (!cached) _showGuideLoading(container);
        await _fetchLeaderboard(key, campus, cat, shuffle, seq);
        return;
    }

    const cached = _getCachedLeaderboard(key);

    if (cached && !force) {
        const gridMatches = container?.dataset.guideKey === key;
        if (!gridMatches) renderLeaderboard(cached, key);
        if (!_isCacheFresh(key)) {
            _fetchLeaderboardInBackground(key, campus, cat, false, seq);
        }
        return;
    }

    if (!cached) {
        _showGuideLoading(container);
        try {
            await prefetchGuideLeaderboard(campus, cat);
            const warmed = _getCachedLeaderboard(key);
            if (warmed) {
                renderLeaderboard(warmed, key);
                _fetchLeaderboardInBackground(key, campus, cat, false, seq);
                return;
            }
        } catch { /* ignore */ }
    }

    await _fetchLeaderboard(key, campus, cat, false, seq);
}

function _fetchLeaderboardInBackground(key, campus, cat, shuffle, seq) {
    _fetchLeaderboard(key, campus, cat, shuffle, seq).catch(() => {});
}

async function _fetchLeaderboard(key, campus, cat, shuffle, seq) {
    try {
        const data = await getGuideLeaderboard(campus, cat, { shuffle });
        if (seq !== _loadLeaderboardSeq) return;
        if (key !== _cacheKey(currentGuideCampus, currentGuideCat)) return;
        _rememberLeaderboard(key, data);
        renderLeaderboard(data, key);
    } catch (err) {
        if (seq !== _loadLeaderboardSeq) return;
        if (key !== _cacheKey(currentGuideCampus, currentGuideCat)) return;
        console.error('排行榜加载失败:', err);
        const container = document.getElementById('guideGrid');
        const fallback = _getCachedLeaderboard(key);
        if (fallback) {
            renderLeaderboard(fallback, key);
            return;
        }
        if (container) {
            container.innerHTML = '<div class="guide-empty">加载失败，请稍后重试</div>';
            container.dataset.guideKey = '';
        }
        showToast('排行榜加载失败');
    }
}

function _applyGuideLikeState(item, btnEl, liked, likeCount) {
    item.liked = Boolean(liked);
    item.like_count = Math.max(0, Number(likeCount || 0));
    _applyGuideLikeUi(item, btnEl);
}

function _applyGuideLikeUi(item, btnEl) {
    if (btnEl) {
        btnEl.classList.toggle('is-liked', Boolean(item.liked));
        if (btnEl.classList.contains('guide-explore-like')) {
            btnEl.innerHTML = item.liked
                ? '<i class="fas fa-heart"></i> 已赞'
                : '<i class="fas fa-heart"></i> 点赞';
        } else if (btnEl.id === 'guideDetailLikeBtn') {
            _syncDetailLikeBtn();
        } else {
            const label = btnEl.querySelector('span');
            if (label) label.textContent = item.liked ? '已点赞' : '点赞支持';
        }
    }

    const card = btnEl?.closest('.guide-waterfall-card');
    const likesStat = card?.querySelector('.guide-stat--likes');
    if (likesStat) {
        likesStat.innerHTML = `<i class="fas fa-heart" aria-hidden="true"></i> ${item.like_count || 0} 赞`;
    }
    const exploreRow = btnEl?.closest('.guide-explore-item');
    if (exploreRow) {
        const meta = exploreRow.querySelector('.guide-explore-meta');
        if (meta) {
            const dist = item.distance_label ? `<span>${esc(item.distance_label)}</span>` : '';
            const rating = item.rating ? `<span><i class="fas fa-star"></i> ${esc(String(item.rating))}</span>` : '';
            const likeMeta = item.like_count
                ? `<span><i class="fas fa-heart"></i> ${item.like_count}</span>`
                : '';
            meta.innerHTML = `${dist}${rating}${likeMeta}`;
        }
    }
    if (_detailItem && (item.poi_id && _detailItem.poi_id === item.poi_id
        || item.place_id && _detailItem.place_id === item.place_id)) {
        _detailItem = { ...item };
        _syncDetailLikeBtn();
    }
    if (_guideViewMode === 'search') {
        _refreshSearchItemLikeState(item);
    }
}

function _invalidateLeaderboardAfterLike(campus, category) {
    const keys = leaderboardKeysForGuideItem(campus, category);
    invalidateLeaderboardCacheKeys(keys);
    for (const key of keys) {
        delete _leaderboardCache[key];
        delete _leaderboardCacheAt[key];
    }
}

async function handleGuideLike(item, btnEl) {
    if (!isLoggedIn()) {
        document.getElementById('authModal').style.display = 'flex';
        return;
    }
    if (btnEl?.disabled) return;

    const cachedPlaceId = resolveGuidePlaceId(item);
    if (cachedPlaceId) item.place_id = cachedPlaceId;

    const key = getGuideLikeKey(item);
    const campus = item.campus || (currentGuideCampus === 'all' ? DEFAULT_CAMPUS : currentGuideCampus);
    const category = item.type || currentGuideCat;
    const prevLiked = Boolean(item.liked);
    const prevCount = Number(item.like_count || 0);
    const targetLiked = !prevLiked;
    const targetCount = targetLiked ? prevCount + 1 : Math.max(0, prevCount - 1);

    if (btnEl) btnEl.disabled = true;
    _applyGuideLikeState(item, btnEl, targetLiked, targetCount);

    try {
        const result = await syncGuideLikeToServer({
            campus,
            category,
            item,
            liked: targetLiked,
        });
        recordGuideLikeSyncResult(key, item, result);
        if (result.place_id) item.place_id = result.place_id;
        const likes = result.likes != null ? Number(result.likes) : targetCount;
        _applyGuideLikeState(item, btnEl, Boolean(result.liked), likes);
        _invalidateLeaderboardAfterLike(campus, category);
        if (_guideViewMode === 'leaderboard') {
            loadLeaderboard({ force: true }).catch(() => {});
        }
    } catch (err) {
        _applyGuideLikeState(item, btnEl, prevLiked, prevCount);
        if (err.message !== 'UNAUTHORIZED') showToast(err.message || '点赞失败，请重试');
    } finally {
        if (btnEl) btnEl.disabled = false;
    }
}

function _refreshSearchItemLikeState(item) {
    const idx = _guideRenderItems.findIndex(
        (row) => (item.poi_id && row.poi_id === item.poi_id) || (item.place_id && row.place_id === item.place_id),
    );
    if (idx >= 0) {
        const likeCount = Math.max(0, Number(item.like_count || 0));
        _guideRenderItems[idx] = { ..._guideRenderItems[idx], ...item, like_count: likeCount };
        const card = document.querySelector(`.guide-waterfall-card[data-guide-idx="${idx}"]`);
        const likesStat = card?.querySelector('.guide-stat--likes');
        if (likesStat) {
            likesStat.innerHTML = `<i class="fas fa-heart" aria-hidden="true"></i> ${likeCount} 赞`;
        }
        const likeBtn = card?.querySelector('.guide-card-like-btn');
        if (likeBtn) {
            likeBtn.classList.toggle('is-liked', Boolean(item.liked));
            const label = likeBtn.querySelector('span');
            if (label) label.textContent = item.liked ? '已点赞' : '点赞支持';
        }
    }
}

function _syncDetailLikeBtn() {
    const btn = document.getElementById('guideDetailLikeBtn');
    const likesEl = document.getElementById('guideDetailLikes');
    if (!_detailItem || !btn) return;
    btn.classList.toggle('is-liked', Boolean(_detailItem.liked));
    document.getElementById('guideDetailLikeText').textContent = _detailItem.liked ? '已点赞' : '点赞';
    const likes = Math.max(0, Number(_detailItem.like_count || 0));
    if (likesEl) likesEl.innerHTML = likes ? `<i class="fas fa-heart"></i> ${likes}` : '';
}

function openGuideDetail(item) {
    ensureGuideModals();
    const cachedPlaceId = resolveGuidePlaceId(item);
    if (cachedPlaceId) item = { ...item, place_id: cachedPlaceId };
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

function _effectiveSearchCampus() {
    if (currentGuideCampus === 'all' || !ALL_CAMPUSES.includes(currentGuideCampus)) {
        return DEFAULT_CAMPUS;
    }
    return currentGuideCampus;
}

function _syncSearchClearBtn() {
    const input = document.getElementById('guideSearchInput');
    const clearBtn = document.getElementById('guideSearchClearBtn');
    if (!input || !clearBtn) return;
    clearBtn.hidden = !(input.value || '').trim();
}

function _hideSearchSuggestions() {
    const box = document.getElementById('guideSearchSuggestions');
    if (box) box.hidden = true;
}

function _updateSearchStatus(payload) {
    const status = document.getElementById('guideSearchStatus');
    if (!status) return;
    if (_guideViewMode !== 'search') {
        status.hidden = true;
        return;
    }
    const campusLabel = payload?.campus || _effectiveSearchCampus();
    const total = payload?.total ?? _guideRenderItems.length;
    const keywordPart = _guideSearchQuery ? `「${_guideSearchQuery}」` : '周边';
    let text = `${campusLabel} · ${currentGuideCat} · ${keywordPart}，共 ${total} 条结果`;
    if (payload?.campus_fallback) {
        text += '（全部校区时默认按鼓楼搜索）';
    }
    status.hidden = false;
    status.innerHTML = `
        <span>${esc(text)}</span>
        <button type="button" class="guide-search-back" id="guideSearchBackBtn">返回排行榜</button>`;
    document.getElementById('guideSearchBackBtn')?.addEventListener('click', clearGuideSearch);
}

function clearGuideSearch() {
    _guideViewMode = 'leaderboard';
    _guideSearchQuery = '';
    _guideSearchPage = 1;
    _guideSearchHasMore = false;
    const input = document.getElementById('guideSearchInput');
    if (input) input.value = '';
    _syncSearchClearBtn();
    _hideSearchSuggestions();
    const status = document.getElementById('guideSearchStatus');
    if (status) status.hidden = true;
    loadLeaderboard({ force: true });
}

function renderGuideSearchGrid(items, { append = false, hasMore = false } = {}) {
    const container = document.getElementById('guideGrid');
    if (!container) return;

    if (!items.length && !append) {
        container.innerHTML = '<div class="guide-empty">未找到相关店铺，换个关键词或分类试试</div>';
        _guideRenderItems = [];
        return;
    }

    if (append) {
        _guideRenderItems = _guideRenderItems.concat(items);
    } else {
        _guideRenderItems = items;
    }
    seedGuideLikeSyncFromItems(items);
    overlayGuideLikeStateOnItems(_guideRenderItems);

    const startIdx = append ? _guideRenderItems.length - items.length : 0;
    let html = append
        ? _guideRenderItems.slice(startIdx).map((item, i) => _guideCardHtml(item, startIdx + i, { showRank: false })).join('')
        : _guideRenderItems.map((item, idx) => _guideCardHtml(item, idx, { showRank: false })).join('');

    if (_guideSearchHasMore || hasMore) {
        html += `
            <div class="guide-load-more-wrap">
                <button type="button" class="guide-load-more-btn" id="guideGridLoadMoreBtn">加载更多</button>
            </div>`;
    }

    if (append) {
        const loadMoreWrap = container.querySelector('.guide-load-more-wrap');
        if (loadMoreWrap) loadMoreWrap.remove();
        container.insertAdjacentHTML('beforeend', html);
    } else {
        container.innerHTML = html;
        _bindGuideGridDelegation(container);
    }

    document.getElementById('guideGridLoadMoreBtn')?.addEventListener('click', () => {
        runGuideSearch(_guideSearchPage + 1, { append: true });
    });
}

async function runGuideSearch(page = 1, { append = false, keyword = null } = {}) {
    if (_guideSearchLoading) return;
    _guideSearchLoading = true;
    const container = document.getElementById('guideGrid');
    const query = keyword != null ? keyword.trim() : (_guideSearchQuery || '').trim();

    _guideSearchQuery = query;
    _guideViewMode = 'search';
    _guideSearchPage = page;
    _syncSearchClearBtn();
    _hideSearchSuggestions();

    if (!append && container) {
        container.innerHTML = '<div class="guide-loading">搜索中…</div>';
    }
    const loadMoreBtn = document.getElementById('guideGridLoadMoreBtn');
    if (append && loadMoreBtn) {
        loadMoreBtn.disabled = true;
        loadMoreBtn.textContent = '加载中…';
    }

    try {
        await _loadGuideConfig();
        const sideTasks = [];
        if (isLoggedIn()) {
            if (hasPendingGuideLikes()) sideTasks.push(flushGuideLikeQueue());
            sideTasks.push(refreshUserGuideLikes());
        }
        const [data] = await Promise.all([
            searchGuidePlaces(
                currentGuideCampus,
                currentGuideCat,
                query,
                page,
                _guideConfig,
            ),
            ...sideTasks,
        ]);
        _guideSearchHasMore = Boolean(data.has_more);
        _updateSearchStatus(data);
        renderGuideSearchGrid(data.items || [], { append, hasMore: data.has_more });
        if (!append) {
            const exploreInput = document.getElementById('guideExploreInput');
            if (exploreInput) exploreInput.value = query;
        }
    } catch (err) {
        console.error('搜索失败:', err);
        if (!append && container) {
            container.innerHTML = '<div class="guide-empty">搜索失败，请稍后重试</div>';
        }
        showToast('搜索失败');
    } finally {
        _guideSearchLoading = false;
        const btn = document.getElementById('guideGridLoadMoreBtn');
        if (btn) {
            btn.disabled = false;
            btn.textContent = '加载更多';
        }
    }
}

async function fetchGuideSuggestions(keyword) {
    const box = document.getElementById('guideSearchSuggestions');
    if (!box || keyword.length < 2) {
        _hideSearchSuggestions();
        return;
    }
    const campus = _effectiveSearchCampus();
    const city = _searchCity(campus);
    const location = _getCampusLocation(campus);
    try {
        const data = await getPlaceSuggestions(keyword, city, location);
        const tips = data.tips || [];
        if (!tips.length) {
            box.hidden = true;
            return;
        }
        box.innerHTML = tips.slice(0, 8).map((tip, idx) => `
            <li data-suggest-idx="${idx}" role="option">
                <div class="guide-suggestion-name">${esc(tip.name)}</div>
                <div class="guide-suggestion-addr">${esc(tip.address || tip.district || '')}</div>
            </li>`).join('');
        box.hidden = false;
        box.querySelectorAll('li').forEach((li) => {
            li.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const idx = parseInt(li.getAttribute('data-suggest-idx'), 10);
                const tip = tips[idx];
                if (!tip) return;
                const input = document.getElementById('guideSearchInput');
                if (input) input.value = tip.name || '';
                _hideSearchSuggestions();
                runGuideSearch(1, { keyword: tip.name || '' });
            });
        });
    } catch {
        _hideSearchSuggestions();
    }
}

function openGuideExplore() {
    const modal = document.getElementById('guideExploreModal');
    if (!modal) return;
    const mainInput = document.getElementById('guideSearchInput');
    const exploreInput = document.getElementById('guideExploreInput');
    if (mainInput && exploreInput) {
        exploreInput.value = (mainInput.value || '').trim();
    }
    modal.style.display = 'flex';
    exploreInput?.focus();
    runGuideExploreSearch(1);
}

function closeGuideExplore() {
    const modal = document.getElementById('guideExploreModal');
    if (modal) modal.style.display = 'none';
}

function _exploreResultHtml(item, idx) {
    const liked = item.liked ? ' is-liked' : '';
    const likeLabel = item.liked ? '已赞' : '点赞';
    return `
        <div class="guide-explore-item" data-explore-idx="${idx}">
            <div class="guide-explore-main">
                <div class="guide-explore-name">${esc(item.name)}</div>
                <div class="guide-explore-addr">${esc(item.address || '')}</div>
                <div class="guide-explore-meta">
                    ${item.distance_label ? `<span>${esc(item.distance_label)}</span>` : ''}
                    ${item.rating ? `<span><i class="fas fa-star"></i> ${esc(item.rating)}</span>` : ''}
                    ${item.like_count ? `<span><i class="fas fa-heart"></i> ${item.like_count}</span>` : ''}
                </div>
            </div>
            <button type="button" class="guide-explore-like${liked}" data-explore-like="${idx}"><i class="fas fa-heart"></i> ${likeLabel}</button>
        </div>`;
}

function _bindExploreResultsDelegation() {
    const results = document.getElementById('guideExploreResults');
    if (!results || results.dataset.exploreBound === 'true') return;
    results.dataset.exploreBound = 'true';
    results.addEventListener('click', async (e) => {
        const likeBtn = e.target.closest('[data-explore-like]');
        if (likeBtn) {
            e.stopPropagation();
            const idx = parseInt(likeBtn.getAttribute('data-explore-like'), 10);
            if (!Number.isNaN(idx) && _exploreItems[idx]) {
                await handleGuideLike(_exploreItems[idx], likeBtn);
            }
            return;
        }
        const row = e.target.closest('.guide-explore-item');
        if (!row) return;
        const idx = parseInt(row.getAttribute('data-explore-idx'), 10);
        if (!Number.isNaN(idx) && _exploreItems[idx]) {
            openGuideDetail(_exploreItems[idx]);
        }
    });
}

function _renderExploreResults(items, { append = false } = {}) {
    const results = document.getElementById('guideExploreResults');
    const footer = document.getElementById('guideExploreFooter');
    if (!results) return;

    if (!items.length && !append) {
        results.innerHTML = '<div class="guide-empty">未找到相关店铺，换个关键词试试</div>';
        _exploreItems = [];
        if (footer) footer.hidden = true;
        return;
    }

    if (append) {
        const offset = _exploreItems.length;
        _exploreItems = _exploreItems.concat(items);
        seedGuideLikeSyncFromItems(items);
        overlayGuideLikeStateOnItems(_exploreItems);
        results.insertAdjacentHTML('beforeend', _exploreItems.slice(offset).map((item, i) => _exploreResultHtml(item, offset + i)).join(''));
    } else {
        _exploreItems = items;
        seedGuideLikeSyncFromItems(items);
        overlayGuideLikeStateOnItems(_exploreItems);
        results.innerHTML = _exploreItems.map((item, idx) => _exploreResultHtml(item, idx)).join('');
    }

    if (footer) footer.hidden = !_exploreHasMore;
}

let _exploreItems = [];

async function runGuideExploreSearch(page = 1, { append = false } = {}) {
    const input = document.getElementById('guideExploreInput');
    const results = document.getElementById('guideExploreResults');
    const loadMoreBtn = document.getElementById('guideExploreLoadMoreBtn');
    if (!results) return;

    const keyword = (input?.value || '').trim();
    _exploreKeyword = keyword;
    _explorePage = page;

    if (!append) {
        results.innerHTML = '<div class="guide-loading">搜索中…</div>';
    } else if (loadMoreBtn) {
        loadMoreBtn.disabled = true;
        loadMoreBtn.textContent = '加载中…';
    }

    try {
        await _loadGuideConfig();
        const data = await searchGuidePlaces(
            currentGuideCampus,
            currentGuideCat,
            keyword,
            page,
            _guideConfig,
        );
        _exploreHasMore = Boolean(data.has_more);
        try {
            _renderExploreResults(data.items || [], { append });
        } catch (renderErr) {
            console.error(renderErr);
            if (!append) {
                results.innerHTML = '<div class="guide-empty">结果渲染失败，请刷新重试</div>';
            }
            throw renderErr;
        }
    } catch (err) {
        console.error(err);
        if (!append) {
            results.innerHTML = '<div class="guide-empty">搜索失败，请稍后重试</div>';
        }
        _exploreHasMore = false;
        const footer = document.getElementById('guideExploreFooter');
        if (footer) footer.hidden = true;
    } finally {
        if (loadMoreBtn) {
            loadMoreBtn.disabled = false;
            loadMoreBtn.textContent = '加载更多';
        }
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
        _leaderboardCacheAt = {};
        try { sessionStorage.removeItem(GUIDE_LB_CACHE_KEY); } catch { /* ignore */ }
        delete window.__njuatlasGuideLbWarm;
        if (isLoggedIn()) {
            await flushGuideLikeQueue();
            await refreshUserGuideLikes({ force: true });
        }
        if (_guideViewMode === 'search') {
            await runGuideSearch(1, { keyword: _guideSearchQuery });
            showToast('搜索结果已刷新');
        } else {
            await loadLeaderboard({ force: true });
            showToast('排行榜已刷新');
        }
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
    if (_guideViewMode === 'search') {
        runGuideSearch(1, { keyword: _guideSearchQuery });
    } else {
        const key = _cacheKey(currentGuideCampus, cat);
        const grid = document.getElementById('guideGrid');
        if (!_showLeaderboardFromCache(key)) {
            _showGuideLoading(grid);
        }
        loadLeaderboard();
    }
}

function filterGuideCampus(campus) {
    currentGuideCampus = campus;
    document.querySelectorAll('#guideCampusFilter .guide-chip').forEach((chip) => {
        chip.classList.toggle('active', chip.getAttribute('data-guide-campus') === campus);
    });
    if (_guideViewMode === 'search') {
        runGuideSearch(1, { keyword: _guideSearchQuery });
    } else {
        const key = _cacheKey(campus, currentGuideCat);
        const grid = document.getElementById('guideGrid');
        if (!_showLeaderboardFromCache(key)) {
            _showGuideLoading(grid);
        }
        loadLeaderboard();
    }
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
        document.getElementById('guideExploreSearchBtn')?.addEventListener('click', () => runGuideExploreSearch(1));
        document.getElementById('guideExploreInput')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') runGuideExploreSearch(1);
        });
        document.getElementById('guideExploreLoadMoreBtn')?.addEventListener('click', () => {
            runGuideExploreSearch(_explorePage + 1, { append: true });
        });
        _bindExploreResultsDelegation();
    }
}

function initGuideSearchBar() {
    const wrap = document.getElementById('guideSearchWrap');
    if (!wrap || wrap.dataset.ready) return;
    wrap.dataset.ready = '1';

    const input = document.getElementById('guideSearchInput');
    const searchBtn = document.getElementById('guideSearchBtn');
    const clearBtn = document.getElementById('guideSearchClearBtn');

    searchBtn?.addEventListener('click', () => runGuideSearch(1, { keyword: input?.value || '' }));
    clearBtn?.addEventListener('click', () => clearGuideSearch());

    input?.addEventListener('input', () => {
        _syncSearchClearBtn();
        clearTimeout(_suggestTimer);
        const kw = (input.value || '').trim();
        if (kw.length < 2) {
            _hideSearchSuggestions();
            return;
        }
        _suggestTimer = setTimeout(() => fetchGuideSuggestions(kw), 280);
    });

    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            _hideSearchSuggestions();
            runGuideSearch(1, { keyword: input.value || '' });
        } else if (e.key === 'Escape') {
            _hideSearchSuggestions();
        }
    });

    input?.addEventListener('blur', () => {
        setTimeout(_hideSearchSuggestions, 150);
    });

    document.addEventListener('click', (e) => {
        if (!wrap.contains(e.target)) _hideSearchSuggestions();
    });
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

    currentGuideCampus = DEFAULT_CAMPUS;
    _syncCampusFilterUi();

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
    await loadLeaderboard();
    _scheduleGuidePageExtras();
}

export async function openGuideWithContext(campus, category) {
    const validCampus = ALL_CAMPUSES.includes(campus) ? campus : DEFAULT_CAMPUS;
    if (category) currentGuideCat = category;
    currentGuideCampus = validCampus;
    _guideViewMode = 'leaderboard';
    _guideSearchQuery = '';

    if (typeof window.switchPage === 'function') {
        await window.switchPage('guide');
    }

    _syncCampusFilterUi();
    document.querySelectorAll('#guideFilter .guide-chip').forEach((chip) => {
        chip.classList.toggle('active', chip.getAttribute('data-guide-cat') === currentGuideCat);
    });

    const grid = document.getElementById('guideGrid');
    const key = _cacheKey(currentGuideCampus, currentGuideCat);
    if (grid && !_showLeaderboardFromCache(key)) {
        _showGuideLoading(grid);
    }
    await loadLeaderboard();
}

export function refreshGuideView() {
    if (!isGuidePrefetchComplete()) {
        scheduleGuideBackgroundPrefetch();
    }
    if (_guideViewMode === 'search') {
        runGuideSearch(_guideSearchPage, { keyword: _guideSearchQuery });
    } else {
        loadLeaderboard();
    }
}

export function onGuidePageHidden() {
    flushGuideLikeQueue();
}

export function prefetchGuideData() {
    return scheduleGuideBackgroundPrefetch();
}

export function initGuidePage() {
    initGuideShellHandlers();
    const grid = document.getElementById('guideGrid');
    if (grid) _bindGuideGridDelegation(grid);
    loadGuideData();
}
