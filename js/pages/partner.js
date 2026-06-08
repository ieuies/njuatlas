import { showToast, formatDate, escapeHtml, wgs84ToGcj02 } from '../utils.js';
import { isLoggedIn, getUser } from '../auth.js';
import { listPosts, getPost, createPost, updatePost, deletePost, togglePostLike, addPostComment, deletePostComment, participateEvent } from '../api.js';
import { API_BASE, loadAmapScript } from '../config.js';

// ============================================================
// 全局状态
// ============================================================
let _allPartnersData = [];        // 已加载的所有帖子缓存（分页累计）
let partnersData = [];            // 当前显示的帖子列表（筛选后的视图，仍指向 _allPartnersData 引用）
let currentCategory = 'all';      // 当前选中的分类标签名

// ---------- 分页状态 ----------
let currentPage = 1;
const PAGE_SIZE = 20;
let hasMore = true;
let isLoading = false;            // 防止重复请求

// 发布/编辑模态框的共享状态（initPartnerModal 和 _openEditPostModal 共用）
let _modalDuration = 'short';        // 'short' | 'long'
let _modalUrgency = 'now';           // 'now' | 'scheduled'
let _modalLocationCoords = null;     // "lng,lat" 字符串

// 高德地图实例（单例：预览和全屏共用同一个 AMap.Map，通过移动 DOM 容器切换）
let _sharedMap = null;
let _sharedMapContainer = null;  // 包裹 map 的可移动 div
let _currentMapParent = null;    // 'preview' | 'full' — 地图当前所在的容器

// 校区坐标映射（WGS-84 → 高德 GCJ-02 转换前）
const CAMPUS_COORDS = {
    '鼓楼': [118.780, 32.058],
    '仙林': [118.954, 32.114],
    '浦口': [118.652, 32.157],
    '苏州': [120.385, 31.355],
};
function _getMapCenter() {
    const user = getUser();
    const campus = user?.campus || '';
    const coords = CAMPUS_COORDS[campus];
    if (coords) return wgs84ToGcj02(coords[0], coords[1]);
    // 默认：鼓楼校区
    return wgs84ToGcj02(118.780, 32.058);
}

// 动态分类颜色（根据标签名生成 HSL 色相）
const categoryColorCache = {};
function _categoryStyle(cat) {
    if (!cat) return { color: '#999', icon: '', tagClass: 'tag-default' };
    if (!categoryColorCache[cat]) {
        const hue = [...cat].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
        categoryColorCache[cat] = {
            color: `hsl(${hue}, 65%, 50%)`,
            icon: '',
            tagClass: 'tag-dynamic',
        };
    }
    return categoryColorCache[cat];
}

// 搭子类型 → emoji 映射
const TYPE_EMOJI = {
    '饭搭子': '🍚',
    '运动搭子': '⚽',
    '学习搭子': '📚',
    '游戏搭子': '🎮',
    '电影搭子': '🎬',
    '旅游搭子': '✈️',
    '音乐搭子': '🎵',
    '摄影搭子': '📷',
};
function _typeEmoji(category) {
    return TYPE_EMOJI[category] || '👥';
}
function _typeLabel(post) {
    const emoji = _typeEmoji(post.category);
    if (post.type === 'event') return `${emoji} 活动组局`;
    return `${emoji} 长期招募`;
}

function _isCurrentUserOwner(item) {
    const user = getUser();
    if (!item || !user) return Boolean(item?.is_owner);
    const currentId = user.id ?? user.user_id;
    const ownerId = item.user_id ?? item.author_id ?? item.owner_id ?? item.user?.id;
    return Boolean(item.is_owner || (currentId != null && ownerId != null && String(currentId) === String(ownerId)));
}

// ============================================================
// 数据加载：分页从后端 API 获取帖子列表
// ============================================================
/** 根据当前分类加载指定页码的数据，append=true 时追加到缓存并追加渲染，否则重置 */
async function loadPostsByPage(page, append = false) {
    if (isLoading) return [];
    isLoading = true;

    try {
        const params = {
            page: page,
            page_size: PAGE_SIZE,
            sort: 'hot',
        };
        if (currentCategory !== 'all') {
            params.tags = currentCategory;
        }

        const result = await listPosts(params);
        let newPosts = (result.items || []).map(_mapPost);

        // ----- 前端兜底过滤：确保只显示当前分类的帖子 -----
        if (currentCategory !== 'all') {
            newPosts = newPosts.filter(post => post.tags.includes(currentCategory));
        }
        // ------------------------------------------------

        hasMore = newPosts.length === PAGE_SIZE;

        if (append) {
            _allPartnersData.push(...newPosts);
            partnersData = _allPartnersData;
            appendWaterfallCards(newPosts);
        } else {
            _allPartnersData = newPosts;
            partnersData = _allPartnersData;
            renderWaterfall();
        }
        return newPosts;
    } catch (err) {
        console.warn('加载帖子失败:', err.message);
        showToast('加载失败，请稍后重试');
        return [];
    } finally {
        isLoading = false;
    }
}
/** 追加渲染新卡片到瀑布流末尾（不重建全部） */
function appendWaterfallCards(posts) {
    const container = document.getElementById('partnerWaterfall');
    if (!container) return;

    const fragment = document.createDocumentFragment();
    posts.forEach(p => {
        fragment.appendChild(createPostCardElement(p));
    });
    container.appendChild(fragment);
    bindCardEvents(container);
}

/** 创建单个卡片 DOM 元素 */
function createPostCardElement(p) {
    const article = document.createElement('article');
    article.className = 'partner-card partner-brief-card';
    article.setAttribute('data-id', p.id);
    article.innerHTML = `
        <div class="partner-card-content">
            <div class="partner-card-head">
                <div class="partner-card-tags">
                    ${p.tags.filter(t => !/^[\d¥￥]/.test(t) && !['AA', '免费', '自费'].includes(t)).slice(0, 3).map(t => `<span class="partner-card-tag">${escapeHtml(t)}</span>`).join('')}
                </div>
                <span class="partner-card-type">${_typeLabel(p)}</span>
            </div>
            <h3 class="partner-card-title">${escapeHtml(p.title)}</h3>
            <p class="partner-card-desc">${escapeHtml(p.description).substring(0, 120)}</p>
            <div class="partner-card-meta" aria-label="组局信息">
                ${p.location ? `<span><b>地点</b><em>${escapeHtml(p.location)}</em></span>` : ''}
                ${p.budget ? `<span><b>预算</b><em>${escapeHtml(p.budget)}</em></span>` : ''}
                ${p.time ? `<span><b>时间</b><em>${escapeHtml(p.time)}</em></span>` : ''}
                <span><b>发起人</b><em>${escapeHtml(p.publisher)}${p.isOwner ? ' 👑' : ''}</em></span>
            </div>
            <div class="partner-card-footer">
                <div class="partner-card-stats">
                    <span>👁 ${p.views}</span>
                    <span>👍 ${p.likeCount}</span>
                    <span>💬 ${p.commentCount}</span>
                    <span>👥 ${p.members}/${p.slots}</span>
                </div>
                ${p.isOwner ? `
                    <button class="join-btn owner-delete-btn" data-id="${p.id}">🗑️ 删除活动</button>
                ` : (p.type === 'event' && p.members >= p.slots && p.participationStatus !== 'going') ? `
                    <button class="join-btn" disabled style="opacity:0.5;cursor:not-allowed;">🚫 已满员</button>
                ` : `
                    <button class="join-btn" data-id="${p.id}">${p.participationStatus === 'going' ? '✅ 已报名·点此取消' : '我要参加'}</button>
                `}
            </div>
        </div>
    `;
    return article;
}

/** 绑定卡片内的按钮事件（删除、参加、卡片点击） */
function bindCardEvents(container) {
    container.querySelectorAll('.owner-delete-btn').forEach(btn => {
        btn.removeEventListener('click', _deleteHandler);
        btn.addEventListener('click', _deleteHandler);
    });
    container.querySelectorAll('.join-btn:not(.owner-delete-btn)').forEach(btn => {
        btn.removeEventListener('click', _joinHandler);
        btn.addEventListener('click', _joinHandler);
    });
    container.querySelectorAll('.partner-card').forEach(card => {
        card.removeEventListener('click', _cardClickHandler);
        card.addEventListener('click', _cardClickHandler);
    });
}

function _deleteHandler(e) {
    e.stopPropagation();
    const id = parseInt(e.currentTarget.getAttribute('data-id'));
    _deletePostCard(id);
}
function _joinHandler(e) {
    e.stopPropagation();
    const id = parseInt(e.currentTarget.getAttribute('data-id'));
    handleParticipate(id);
}
function _cardClickHandler(e) {
    if (e.target.closest('button')) return;
    const id = parseInt(e.currentTarget.getAttribute('data-id'));
    if (id) openPostDetail(id);
}

/** 全量渲染瀑布流（用于重置分类或首次加载） */
function renderWaterfall() {
    const container = document.getElementById('partnerWaterfall');
    if (!container) return;

    if (!_allPartnersData.length) {
        container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-tertiary);">暂无组局，快来发起第一个吧~</div>';
        return;
    }

    const fragment = document.createDocumentFragment();
    _allPartnersData.forEach(p => {
        fragment.appendChild(createPostCardElement(p));
    });
    container.innerHTML = '';
    container.appendChild(fragment);
    bindCardEvents(container);
}

/** 客户端筛选：从全量缓存中按 currentCategory 过滤到 partnersData（已不做筛选，因为请求时已带 tags） */
function _applyCategoryFilter() {
    // 由于后端请求时已经带 tags 参数，缓存数据即当前分类数据，无需前端再过滤
    partnersData = _allPartnersData;
}

/** 切换分类时重置分页并重新加载 */
async function switchCategory(category) {
    if (currentCategory === category) return;
    currentCategory = category;
    currentPage = 1;
    hasMore = true;
    _allPartnersData = [];
    partnersData = [];

    const container = document.getElementById('partnerWaterfall');
    if (container) container.innerHTML = '<div style="text-align:center;padding:2rem;">加载中...</div>';

    await loadPostsByPage(1, false);
    refreshPreviewMarkers();
}

/** 将后端帖子格式映射为前端卡片和地图所需的字段 */
function _mapPost(p) {
    return {
        id: p.id,
        type: p.type,
        category: (p.tags && p.tags.length > 0) ? p.tags[0] : '其他',
        tags: p.tags || [],
        title: p.title,
        description: p.content,
        location: p.location_name || '',
        lnglat: p.location ? p.location.split(',').map(Number) : null,
        urgency: p.urgency || null,
        time: _formatPostTime(p.event_time, p.urgency),
        publisher: p.username || '匿名同学',
        publisherId: p.user_id,
        members: p.participant_count || 0,
        slots: p.max_participants || 1,
        budget: p.budget || '',
        contact: p.contact || '',
        views: p.view_count || 0,
        likeCount: p.like_count || 0,
        commentCount: p.comment_count || 0,
        hotScore: p.hot_score || 0,
        isLiked: p.is_liked || false,
        isOwner: _isCurrentUserOwner(p),
        participationStatus: p.participation_status,
        createdAt: formatDate(p.created_at),
        nearby: '',
    };
}

function _formatPostTime(iso, urgency) {
    if (urgency === 'now') return '立即';
    if (urgency === 'long_term') return '长期有效';
    if (!iso) return urgency === 'scheduled' ? '已设定' : '';
    const d = new Date(iso);
    const now = new Date();
    const diffDays = Math.floor((d - now) / (1000 * 60 * 60 * 24));
    const time = d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    if (diffDays === 0) return `今天 ${time.split(' ')[1] || ''}`;
    if (diffDays === 1) return `明天 ${time.split(' ')[1] || ''}`;
    return time;
}

// ============================================================
// 高德地图初始化（保持不变）
// ============================================================
async function ensureAMap() {
    if (window.AMap) return window.AMap;
    try {
        await loadAmapScript();
        if (window.AMap) return window.AMap;
        throw new Error('AMap SDK 加载后 window.AMap 仍然不可用');
    } catch (err) {
        console.warn('高德地图加载失败:', err.message);
        throw err;
    }
}

function _getOrCreateSharedMap(targetParent) {
    const containerId = targetParent === 'full' ? 'fullMap' : 'previewMap';
    const target = document.getElementById(containerId);
    if (!target) return null;

    if (_sharedMap && _currentMapParent === targetParent) {
        return _sharedMap;
    }

    const center = _getMapCenter();

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
        _currentMapParent = targetParent;
        _setupResizeObserver();
    } else {
        target.innerHTML = '';
        target.appendChild(_sharedMapContainer);
        _currentMapParent = targetParent;
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
        _currentMapParent = null;
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

function addMarkersToMap(map, data) {
    map.clearMap();
    if (!data.length) return [];

    const markers = [];
    data.forEach(post => {
        const coords = post.lnglat;
        if (!coords || coords.length < 2 || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) {
            return;
        }
        const style = _categoryStyle(post.category);
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

document.addEventListener('click', (e) => {
    const btn = e.target.closest('.map-join-btn');
    if (!btn) return;
    const postId = parseInt(btn.getAttribute('data-post-id'));
    if (postId) handleParticipate(postId);
});

async function initPreviewMap() {
    try {
        await ensureAMap();
        await new Promise((resolve) => {
            const doInit = () => {
                try {
                    const map = _getOrCreateSharedMap('preview');
                    if (map) {
                        addMarkersToMap(map, partnersData);
                    }
                } catch (e) {
                    console.warn('地图渲染失败:', e);
                }
                resolve();
            };
            if (window.requestIdleCallback) {
                requestIdleCallback(doInit, { timeout: 3000 });
            } else {
                setTimeout(doInit, 50);
            }
        });
    } catch (err) {
        console.warn('预览地图初始化失败:', err);
    }
}

async function refreshPreviewMarkers() {
    if (_currentMapParent !== 'preview') return;
    const map = _sharedMap;
    if (!map) {
        await initPreviewMap();
        return;
    }
    addMarkersToMap(map, partnersData);
}

function initMobileMapToggle() {
    if (window.innerWidth > 768) return;
    const card = document.getElementById('mapPreviewCard');
    if (!card || card._toggleReady) return;
    card._toggleReady = true;

    const header = card.querySelector('.map-preview-header');
    if (!header) return;

    header.style.cursor = 'pointer';
    const title = header.querySelector('.map-preview-title');
    if (title && !title.querySelector('.map-toggle-chevron')) {
        const chevron = document.createElement('span');
        chevron.className = 'map-toggle-chevron';
        chevron.innerHTML = '<i class="fas fa-chevron-down"></i>';
        title.appendChild(chevron);
    }

    header.addEventListener('click', (e) => {
        if (e.target.closest('#mapExpandBtn')) return;
        const isExpanded = card.classList.toggle('map-expanded');
        if (isExpanded) {
            requestAnimationFrame(() => {
                if (_sharedMap) _sharedMap.resize();
                setTimeout(() => _sharedMap?.resize(), 400);
            });
        }
    });
}

async function initFullMapMarkers() {
    try {
        await ensureAMap();
        const container = document.getElementById('fullMap');
        if (!container || container.offsetWidth === 0) {
            await new Promise(r => setTimeout(r, 200));
        }
        await new Promise((resolve) => {
            const doInit = () => {
                try {
                    const map = _getOrCreateSharedMap('full');
                    if (map) {
                        addMarkersToMap(map, partnersData);
                        setTimeout(() => map.resize(), 100);
                    }
                } catch (e) {
                    console.warn('全屏地图渲染失败:', e);
                }
                resolve();
            };
            if (window.requestIdleCallback) {
                requestIdleCallback(doInit, { timeout: 3000 });
            } else {
                setTimeout(doInit, 50);
            }
        });
    } catch (err) {
        console.warn('全屏地图初始化失败:', err);
    }
}

window.initFullMapMarkers = initFullMapMarkers;

// ============================================================
// 参与活动 & 删除帖子等操作（需刷新分页缓存）
// ============================================================
function _updateSingleCardDOM(postId, status, participantCount, slots) {
    const card = document.querySelector(`.partner-card[data-id="${postId}"]`);
    if (!card) return;
    const btn = card.querySelector('.join-btn:not(.owner-delete-btn)');
    if (btn) {
        btn.textContent = status === 'going' ? '✅ 已报名·点此取消' : '我要参加';
    }
    const statSpans = card.querySelectorAll('.partner-card-stats span');
    if (statSpans.length >= 4) {
        statSpans[3].textContent = `👥 ${participantCount}/${slots}`;
    }
}

async function handleParticipate(postId) {
    if (!isLoggedIn()) {
        showToast('请先登录');
        const authModal = document.getElementById('authModal');
        if (authModal) authModal.style.display = 'flex';
        return;
    }
    try {
        const result = await participateEvent(postId, 'going');
        _applyParticipationResult(postId, result);
        if (result.status === 'going') {
            showToast('报名成功');
        } else if (result.status === null) {
            showToast('已取消报名');
        }
        const post = _allPartnersData.find(p => p.id === postId);
        _updateSingleCardDOM(postId, result.status, post?.members || 0, post?.slots || 1);
        // 后台静默刷新当前页面数据（不重置分页，仅更新缓存）
        _silentRefreshCurrentPage();
    } catch (err) {
        showToast('操作失败: ' + err.message);
    }
}

function _applyParticipationResult(postId, result) {
    const post = _allPartnersData.find(p => p.id === postId);
    if (!post) return;
    post.participationStatus = result.status ?? null;
    if (typeof result.participant_count === 'number') {
        post.members = result.participant_count;
    } else if (result.status === 'going') {
        post.members += 1;
    } else if (result.status === null && post.members > 0) {
        post.members -= 1;
    }
}

async function _silentRefreshCurrentPage() {
    // 静默重新加载当前页码的数据，更新缓存但不改变 UI 滚动位置
    if (isLoading) return;
    isLoading = true;
    try {
        const params = {
            page: currentPage,
            page_size: PAGE_SIZE,
            sort: 'hot',
        };
        if (currentCategory !== 'all') {
            params.tags = currentCategory;
        }
        const result = await listPosts(params);
        const newPosts = (result.items || []).map(_mapPost);
        // 替换当前页在缓存中的部分（简单做法：整体重新拉取并重置全部，但保留已加载的页数？为了简单，重置整个缓存为第一页）
        // 更严谨：只更新当前页对应的条目，但为了保持简单且不错位，这里重置缓存并重新加载第一页，同时重置滚动位置。
        // 注意：这会丢失之前已加载的后续页面，但保证了数据一致性，体验尚可。
        if (currentPage === 1) {
            _allPartnersData = newPosts;
            partnersData = _allPartnersData;
            renderWaterfall();
            refreshPreviewMarkers();
        } else {
            // 如果不是第一页，重置到第一页以避免数据错乱
            currentPage = 1;
            _allPartnersData = newPosts;
            partnersData = _allPartnersData;
            renderWaterfall();
            refreshPreviewMarkers();
        }
    } catch (err) {
        console.warn('静默刷新失败', err);
    } finally {
        isLoading = false;
    }
}

async function _deletePostCard(postId) {
    if (!confirm('⚠️ 确定要删除这条组局吗？\n\n此操作不可撤销，所有评论和报名数据将被永久删除。')) return;
    try {
        await deletePost(postId);
        showToast('已删除');
        // 重置分页并重新加载第一页
        currentPage = 1;
        hasMore = true;
        await loadPostsByPage(1, false);
        refreshPreviewMarkers();
    } catch (err) {
        showToast('删除失败: ' + err.message);
    }
}

// ============================================================
// 帖子详情模态框（保持不变，略作适配）
// ============================================================
let currentDetailPost = null;

function initPostDetailModal() {
    const modal = document.getElementById('postDetailModal');
    if (!modal) return;

    const closeBtn = document.getElementById('closePostDetailBtn');
    const likeBtn = document.getElementById('detailLikeBtn');
    const participateBtn = document.getElementById('detailParticipateBtn');
    const commentInput = document.getElementById('detailCommentInput');
    const commentSubmitBtn = document.getElementById('detailCommentSubmitBtn');

    closeBtn?.addEventListener('click', () => {
        modal.style.display = 'none';
        currentDetailPost = null;
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
            currentDetailPost = null;
        }
    });

    likeBtn?.addEventListener('click', async () => {
        if (!currentDetailPost) return;
        if (!isLoggedIn()) { showToast('请先登录'); return; }
        const prevLiked = currentDetailPost.is_liked;
        const prevCount = currentDetailPost.like_count || 0;
        currentDetailPost.is_liked = !prevLiked;
        currentDetailPost.like_count = prevLiked ? prevCount - 1 : prevCount + 1;
        _updateDetailStats();
        likeBtn.classList.toggle('liked', currentDetailPost.is_liked);
        likeBtn.textContent = currentDetailPost.is_liked ? '已点赞' : '点赞';
        try {
            const result = await togglePostLike(currentDetailPost.id);
            currentDetailPost.is_liked = result.liked;
            currentDetailPost.like_count = result.like_count;
            _updateDetailStats();
            likeBtn.classList.toggle('liked', result.liked);
            likeBtn.textContent = result.liked ? '已点赞' : '点赞';
        } catch (err) {
            currentDetailPost.is_liked = prevLiked;
            currentDetailPost.like_count = prevCount;
            _updateDetailStats();
            likeBtn.classList.toggle('liked', prevLiked);
            likeBtn.textContent = prevLiked ? '已点赞' : '点赞';
            showToast('操作失败: ' + err.message);
        }
    });

    participateBtn?.addEventListener('click', async () => {
        if (!currentDetailPost) return;
        if (!isLoggedIn()) { showToast('请先登录'); return; }
        const prevStatus = currentDetailPost.participation_status;
        const prevCount = currentDetailPost.participant_count || 0;
        const newStatus = prevStatus === 'going' ? null : 'going';
        currentDetailPost.participation_status = newStatus;
        currentDetailPost.participant_count = newStatus === 'going' ? prevCount + 1 : Math.max(0, prevCount - 1);
        _updateDetailStats();
        participateBtn.textContent = newStatus === 'going' ? '已报名，点击取消' : '我要参加';
        participateBtn.classList.toggle('going', newStatus === 'going');
        const user = getUser();
        if (user && user.username) {
            _optimisticUpdateParticipants(newStatus, user);
        }
        try {
            const result = await participateEvent(currentDetailPost.id, 'going');
            currentDetailPost.participation_status = result.status;
            currentDetailPost.participant_count = result.participant_count;
            _applyParticipationResult(currentDetailPost.id, result);
            _updateDetailStats();
            const going = result.status === 'going';
            participateBtn.textContent = going ? '已报名，点击取消' : '我要参加';
            participateBtn.classList.toggle('going', going);
            _refreshDetailParticipants(currentDetailPost.id);
            _silentRefreshCurrentPage();
        } catch (err) {
            currentDetailPost.participation_status = prevStatus;
            currentDetailPost.participant_count = prevCount;
            _updateDetailStats();
            participateBtn.textContent = prevStatus === 'going' ? '已报名，点击取消' : '我要参加';
            participateBtn.classList.toggle('going', prevStatus === 'going');
            _revertOptimisticParticipants(prevStatus, user);
            showToast('操作失败: ' + err.message);
        }
    });

    commentSubmitBtn?.addEventListener('click', async () => {
        const content = commentInput.value.trim();
        if (!content) { showToast('请输入评论内容'); return; }
        if (!currentDetailPost) return;
        if (!isLoggedIn()) { showToast('请先登录'); return; }
        try {
            await addPostComment(currentDetailPost.id, content);
            commentInput.value = '';
            showToast('评论发表成功');
            await _refreshDetailComments(currentDetailPost.id);
        } catch (err) {
            showToast('评论失败: ' + err.message);
        }
    });

    document.getElementById('detailEditBtn')?.addEventListener('click', () => {
        if (!currentDetailPost) return;
        _openEditPostModal(currentDetailPost);
    });

    document.getElementById('detailDeleteBtn')?.addEventListener('click', async () => {
        if (!currentDetailPost) return;
        if (!confirm('确定要删除这条组局吗？此操作不可撤销。')) return;
        try {
            await deletePost(currentDetailPost.id);
            showToast('已删除');
            document.getElementById('postDetailModal').style.display = 'none';
            currentDetailPost = null;
            currentPage = 1;
            hasMore = true;
            await loadPostsByPage(1, false);
            refreshPreviewMarkers();
        } catch (err) {
            showToast('删除失败: ' + err.message);
        }
    });
}

function _openEditPostModal(post) {
    const modal = document.getElementById('partnerModal');
    if (!modal) return;
    document.getElementById('postDetailModal').style.display = 'none';

    document.getElementById('partnerCategory').value = (post.tags && post.tags[0]) ? post.tags[0] : '';
    document.getElementById('partnerTitle').value = post.title || '';
    document.getElementById('partnerDesc').value = post.content || '';
    document.getElementById('partnerLocation').value = post.location_name || '';
    document.getElementById('partnerBudget').value = post.budget || '';
    document.getElementById('partnerSlots').value = post.max_participants || 1;
    document.getElementById('partnerContact').value = post.contact || '';

    _modalDuration = (post.type === 'forum') ? 'long' : 'short';
    const durationBtns = document.querySelectorAll('#durationRow .time-mode-btn');
    durationBtns.forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-duration') === _modalDuration);
    });
    const timeModeRow = document.getElementById('timeModeRow');
    if (timeModeRow) timeModeRow.style.display = _modalDuration === 'long' ? 'none' : 'flex';

    _modalUrgency = (post.urgency === 'scheduled') ? 'scheduled' : 'now';
    const timeModeBtns = document.querySelectorAll('#timeModeRow .time-mode-btn');
    timeModeBtns.forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-mode') === _modalUrgency);
    });
    const scheduledRow = document.getElementById('scheduledTimeRow');
    if (scheduledRow) {
        scheduledRow.style.display = _modalUrgency === 'scheduled' ? 'flex' : 'none';
    }
    if (post.event_time) {
        const d = new Date(post.event_time);
        document.getElementById('partnerDate').value = d.toISOString().split('T')[0];
        const time = d.toTimeString().split(' ')[0].substring(0, 5);
        document.getElementById('partnerTimePicker').value = time;
    }

    _modalLocationCoords = post.location || null;
    modal.setAttribute('data-edit-id', post.id);
    modal.style.display = 'flex';
}

function _mapCachedToDetailFormat(cached) {
    if (!cached) return null;
    return {
        id: cached.id,
        type: cached.type,
        title: cached.title,
        content: cached.description,
        tags: cached.tags,
        username: cached.publisher,
        event_time: cached.time === '立即' || cached.time === '长期有效' ? null : null,
        urgency: cached.urgency,
        location_name: cached.location,
        budget: cached.budget,
        contact: cached.contact,
        is_owner: cached.isOwner,
        like_count: cached.likeCount,
        view_count: cached.views,
        comment_count: cached.commentCount,
        participant_count: cached.members,
        max_participants: cached.slots,
        is_liked: cached.isLiked,
        participation_status: cached.participationStatus,
        _fromCache: true,
    };
}

async function openPostDetail(postId) {
    const modal = document.getElementById('postDetailModal');
    if (!modal) return;

    modal.style.display = 'flex';
    _resetDetailUI();

    const cached = _allPartnersData.find(p => p.id === postId);
    if (cached) {
        const quick = _mapCachedToDetailFormat(cached);
        _renderPostDetail(quick);
        document.getElementById('detailComments').innerHTML = '<div class="detail-comments-empty">加载评论中...</div>';
    }

    try {
        const post = await getPost(postId);
        currentDetailPost = post;
        _renderPostDetail(post);
    } catch (err) {
        if (!cached) {
            showToast('加载帖子详情失败: ' + err.message);
            modal.style.display = 'none';
            currentDetailPost = null;
        } else {
            console.warn('帖子详情刷新失败:', err.message);
            currentDetailPost = cached;
        }
    }
}

function _resetDetailUI() {
    document.getElementById('detailTitle').textContent = '加载中...';
    document.getElementById('detailBody').textContent = '';
    document.getElementById('detailTags').innerHTML = '';
    document.getElementById('detailPublisher').textContent = '';
    document.getElementById('detailTime').textContent = '';
    document.getElementById('detailLocation').textContent = '';
    document.getElementById('detailBudget').textContent = '';
    document.getElementById('detailBudget').style.display = 'none';
    document.getElementById('detailContact').textContent = '';
    document.getElementById('detailContact').style.display = 'none';
    document.getElementById('detailComments').innerHTML = '';
    document.getElementById('detailParticipants').innerHTML = '';
    document.getElementById('detailParticipantsSection').style.display = 'none';
    var pb = document.getElementById('detailParticipateBtn');
    pb.style.display = 'none';
    pb.textContent = '我要参加';
    pb.classList.remove('going');
    pb.disabled = false;
    document.getElementById('detailLikeBtn').classList.remove('liked');
    document.getElementById('detailLikeBtn').textContent = '点赞';
    var oa = document.getElementById('detailOwnerActions');
    if (oa) oa.style.display = 'none';
}

function _renderPostDetail(post) {
    document.getElementById('detailTitle').textContent = post.title;
    document.getElementById('detailBody').innerHTML = safeHtmlWithBreaks(post.content || '');

    const tags = post.tags || [];
    document.getElementById('detailTags').innerHTML = tags.map(t => `<span class="post-detail-tag">${escapeHtml(t)}</span>`).join('');

    document.getElementById('detailPublisher').innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(post.username || '匿名')}`;
    const timeStr = _formatPostTime(post.event_time, post.urgency);
    document.getElementById('detailTime').innerHTML = `<i class="fas fa-clock"></i> ${escapeHtml(timeStr)}`;
    if (post.location_name) {
        document.getElementById('detailLocation').innerHTML = `<i class="fas fa-map-pin"></i> ${escapeHtml(post.location_name)}`;
    }
    if (post.budget) {
        document.getElementById('detailBudget').innerHTML = `<i class="fas fa-yen-sign"></i> ${escapeHtml(post.budget)}`;
        document.getElementById('detailBudget').style.display = '';
    } else {
        document.getElementById('detailBudget').style.display = 'none';
    }
    if (post.contact) {
        document.getElementById('detailContact').innerHTML = `<i class="fas fa-address-book"></i> ${escapeHtml(post.contact)}`;
        document.getElementById('detailContact').style.display = '';
    } else {
        document.getElementById('detailContact').style.display = 'none';
    }

    _updateDetailStats(post);
    const slots = post.max_participants || 1;
    document.getElementById('detailParticipantCount').textContent = `${post.participant_count || 0}/${slots}人`;

    const likeBtn = document.getElementById('detailLikeBtn');
    likeBtn.classList.remove('liked');
    likeBtn.textContent = '点赞';
    if (post.is_liked) {
        likeBtn.classList.add('liked');
        likeBtn.textContent = '已点赞';
    }

    const participateBtn = document.getElementById('detailParticipateBtn');
    const ownerActions = document.getElementById('detailOwnerActions');
    const isFull = (post.participant_count || 0) >= (post.max_participants || 1);
    if (post.is_owner) {
        participateBtn.style.display = 'none';
        if (ownerActions) ownerActions.style.display = 'flex';
    } else if (isFull && post.participation_status !== 'going') {
        participateBtn.style.display = 'block';
        participateBtn.textContent = '🚫 已满员';
        participateBtn.disabled = true;
        participateBtn.classList.remove('going');
        if (ownerActions) ownerActions.style.display = 'none';
    } else {
        participateBtn.style.display = 'block';
        participateBtn.disabled = false;
        const going = post.participation_status === 'going';
        participateBtn.textContent = going ? '已报名，点击取消' : '我要参加';
        participateBtn.classList.toggle('going', going);
        if (ownerActions) ownerActions.style.display = 'none';
    }

    _renderDetailParticipants(post.participants || []);
    _renderDetailComments(post.comments || { items: [] });
}

function _updateDetailStats(postOverride) {
    const post = postOverride || currentDetailPost;
    if (!post) return;
    document.getElementById('detailViewCount').textContent = post.view_count || 0;
    document.getElementById('detailLikeCount').textContent = post.like_count || 0;
    document.getElementById('detailCommentCount').textContent = post.comment_count || 0;
    document.getElementById('detailParticipantCount').textContent = post.participant_count || 0;
}

function _renderDetailParticipants(participants) {
    const section = document.getElementById('detailParticipantsSection');
    const container = document.getElementById('detailParticipants');
    if (!participants.length) {
        section.style.display = 'none';
        return;
    }
    section.style.display = 'block';
    container.innerHTML = participants.map(p => `
        <span class="participant-chip${p.is_organizer ? ' organizer' : ''}">
            ${escapeHtml(p.username || '用户')}
            ${p.is_organizer ? '<span class="participant-status organizer-badge" title="发起人">👑 发起人</span>' : ''}
            <span class="participant-status${p.status === 'interested' ? ' interested' : ''}">${p.status === 'going' ? '确定' : '感兴趣'}</span>
        </span>
    `).join('');
}

function _optimisticUpdateParticipants(newStatus, user) {
    const section = document.getElementById('detailParticipantsSection');
    const container = document.getElementById('detailParticipants');
    if (!section || !container) return;
    section.style.display = 'block';
    if (newStatus === 'going') {
        const chip = document.createElement('span');
        chip.className = 'participant-chip optimistic';
        chip.dataset.optimisticUser = user.username;
        chip.innerHTML = `${escapeHtml(user.username || '用户')}<span class="participant-status">确定</span>`;
        container.appendChild(chip);
    } else {
        const chips = container.querySelectorAll('.participant-chip');
        for (const c of chips) {
            if (c.textContent.includes(user.username) && !c.classList.contains('organizer')) {
                c.remove();
                break;
            }
        }
    }
    if (!container.querySelector('.participant-chip')) {
        section.style.display = 'none';
    }
}

function _revertOptimisticParticipants(prevStatus, user) {
    const container = document.getElementById('detailParticipants');
    if (!container) return;
    if (prevStatus !== 'going') {
        const chip = container.querySelector(`[data-optimistic-user="${user.username}"]`);
        if (chip) chip.remove();
    } else {
        const chip = document.createElement('span');
        chip.className = 'participant-chip';
        chip.innerHTML = `${escapeHtml(user.username || '用户')}<span class="participant-status">确定</span>`;
        container.appendChild(chip);
    }
}

function _renderDetailComments(commentsData) {
    const items = commentsData.items || [];
    const container = document.getElementById('detailComments');
    document.getElementById('detailCommentTotal').textContent = commentsData.total || items.length;

    if (!items.length) {
        container.innerHTML = '<div class="detail-comments-empty">暂无评论，来抢沙发吧~</div>';
        return;
    }

    container.innerHTML = items.map(c => {
        const canDeleteComment = _isCurrentUserOwner(c);
        return `
        <div class="detail-comment" data-comment-id="${c.id}">
            <div class="detail-comment-header">
                <span class="detail-comment-user">${escapeHtml(c.username || '用户')}${canDeleteComment ? ' <span class="comment-owner-badge">作者</span>' : ''}</span>
                <span class="detail-comment-time">${formatDate(c.created_at)}</span>
            </div>
            <div class="detail-comment-body">${escapeHtml(c.content)}</div>
            <div class="detail-comment-actions">
                <button class="detail-comment-reply-btn" data-comment-id="${c.id}">回复</button>
                ${canDeleteComment ? `<button class="detail-comment-delete-btn" data-comment-id="${c.id}" title="删除评论">删除</button>` : ''}
            </div>
            ${(c.replies && c.replies.length) ? `
                <div class="detail-comment-replies">
                    ${c.replies.map(r => {
                        const canDeleteReply = _isCurrentUserOwner(r);
                        return `
                        <div class="detail-comment" data-comment-id="${r.id}">
                            <div class="detail-comment-header">
                                <span class="detail-comment-user">${escapeHtml(r.username || '用户')}${canDeleteReply ? ' <span class="comment-owner-badge">作者</span>' : ''}</span>
                                <span class="detail-comment-time">${formatDate(r.created_at)}</span>
                            </div>
                            <div class="detail-comment-body">${escapeHtml(r.content)}</div>
                            <div class="detail-comment-actions">
                                ${canDeleteReply ? `<button class="detail-comment-delete-btn" data-comment-id="${r.id}" title="删除回复">删除</button>` : ''}
                            </div>
                        </div>
                    `}).join('')}
                </div>
            ` : ''}
        </div>
    `}).join('');

    container.querySelectorAll('.detail-comment-reply-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const commentId = parseInt(btn.getAttribute('data-comment-id'));
            _showReplyInput(btn.closest('.detail-comment'), commentId);
        });
    });

    container.querySelectorAll('.detail-comment-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const commentId = parseInt(btn.getAttribute('data-comment-id'));
            if (!confirm('确定要删除这条评论吗？')) return;
            try {
                await deletePostComment(currentDetailPost.id, commentId);
                showToast('评论已删除');
                await _refreshDetailComments(currentDetailPost.id);
            } catch (err) {
                showToast('删除失败: ' + err.message);
            }
        });
    });
}

function _showReplyInput(commentEl, parentId) {
    if (commentEl.querySelector('.detail-reply-input-row')) return;
    const row = document.createElement('div');
    row.className = 'detail-reply-input-row';
    row.innerHTML = `
        <input type="text" placeholder="写下回复..." maxlength="300">
        <button>发送</button>
    `;
    commentEl.appendChild(row);
    const input = row.querySelector('input');
    const btn = row.querySelector('button');
    input.focus();

    const doReply = async () => {
        const content = input.value.trim();
        if (!content) { showToast('请输入回复内容'); return; }
        if (!isLoggedIn()) { showToast('请先登录'); return; }
        try {
            await addPostComment(currentDetailPost.id, content, parentId);
            row.remove();
            showToast('回复成功');
            await _refreshDetailComments(currentDetailPost.id);
        } catch (err) {
            showToast('回复失败: ' + err.message);
        }
    };
    btn.addEventListener('click', doReply);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doReply();
        if (e.key === 'Escape') row.remove();
    });
}

async function _refreshDetailComments(postId) {
    try {
        const post = await getPost(postId);
        currentDetailPost = post;
        _renderDetailComments(post.comments || { items: [] });
        _updateDetailStats();
    } catch (e) { /* ignore */ }
}

async function _refreshDetailParticipants(postId) {
    try {
        const post = await getPost(postId);
        currentDetailPost = post;
        _renderDetailParticipants(post.participants || []);
    } catch (e) { /* ignore */ }
}

// ============================================================
// 分类筛选（固定分类，动态生成）
// ============================================================
const FIXED_CATEGORIES = [
    { label: '全部', category: 'all' },
    { label: '🍚 饭搭子', category: '饭搭子' },
    { label: '⚽ 运动搭子', category: '运动搭子' },
    { label: '📚 学习搭子', category: '学习搭子' },
    { label: '🎮 游戏搭子', category: '游戏搭子' },
    { label: '🎬 电影搭子', category: '电影搭子' },
    { label: '✈️ 旅游搭子', category: '旅游搭子' },
    { label: '🎵 音乐搭子', category: '音乐搭子' },
    { label: '📷 摄影搭子', category: '摄影搭子' },
];

function initFilters() {
    const container = document.getElementById('partnerFilter');
    if (!container) return;

    container.innerHTML = FIXED_CATEGORIES.map((c, i) =>
        `<span class="filter-chip${i === 0 ? ' active' : ''}" data-category="${escapeHtml(c.category)}">${escapeHtml(c.label)}</span>`
    ).join('');

    container.querySelectorAll('.filter-chip').forEach(chip => {
        chip.style.flexShrink = '0';
        chip.addEventListener('click', () => {
            const category = chip.getAttribute('data-category');
            container.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            switchCategory(category);
        });
    });

    setupCategoryScrollArrows();
}

function setupCategoryScrollArrows() {
    const originalFilter = document.getElementById('partnerFilter');
    if (!originalFilter) return;

    const existingContainer = originalFilter.closest('.filter-slider-container');
    if (existingContainer) {
        bindArrowEvents(existingContainer);
        requestAnimationFrame(() => window._refreshCategoryArrows?.());
        return;
    }

    const parent = originalFilter.parentNode;
    const container = document.createElement('div');
    container.className = 'filter-slider-container';

    const leftArrow = document.createElement('button');
    leftArrow.className = 'scroll-arrow scroll-arrow-left';
    leftArrow.innerHTML = '<i class="fas fa-chevron-left"></i>';
    leftArrow.setAttribute('aria-label', '向左滑动');

    const rightArrow = document.createElement('button');
    rightArrow.className = 'scroll-arrow scroll-arrow-right';
    rightArrow.innerHTML = '<i class="fas fa-chevron-right"></i>';
    rightArrow.setAttribute('aria-label', '向右滑动');

    const scrollWrapper = document.createElement('div');
    scrollWrapper.className = 'filter-scroll-wrapper';

    container.appendChild(leftArrow);
    container.appendChild(scrollWrapper);
    container.appendChild(rightArrow);
    parent.insertBefore(container, originalFilter);
    scrollWrapper.appendChild(originalFilter);

    bindArrowEvents(container);
    window.addEventListener('resize', () => window._refreshCategoryArrows?.());

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            requestAnimationFrame(() => window._refreshCategoryArrows?.());
        });
    }
    setTimeout(() => window._refreshCategoryArrows?.(), 100);
    setTimeout(() => window._refreshCategoryArrows?.(), 500);
}

function bindArrowEvents(container) {
    const leftArrow = container.querySelector('.scroll-arrow-left');
    const rightArrow = container.querySelector('.scroll-arrow-right');
    const scrollWrapper = container.querySelector('.filter-scroll-wrapper');
    if (!leftArrow || !rightArrow || !scrollWrapper) return;

    const scrollStep = (direction) => {
        const amount = Math.max(180, scrollWrapper.clientWidth * 0.75);
        const target = scrollWrapper.scrollLeft + (direction === 'left' ? -amount : amount);
        scrollWrapper.scrollTo({ left: target, behavior: 'smooth' });
    };

    leftArrow.addEventListener('click', (e) => { e.stopPropagation(); scrollStep('left'); });
    rightArrow.addEventListener('click', (e) => { e.stopPropagation(); scrollStep('right'); });

    const updateState = () => {
        const maxScroll = scrollWrapper.scrollWidth - scrollWrapper.clientWidth;
        const current = scrollWrapper.scrollLeft;
        const hasOverflow = maxScroll > 2;

        if (hasOverflow) {
            const showLeft = current > 2;
            const showRight = current < maxScroll - 2;
            leftArrow.classList.toggle('is-hidden', !showLeft);
            rightArrow.classList.toggle('is-hidden', !showRight);
        } else {
            leftArrow.classList.add('is-hidden');
            rightArrow.classList.add('is-hidden');
        }

        scrollWrapper.classList.toggle('has-mask-left', hasOverflow && current > 2);
        scrollWrapper.classList.toggle('has-mask-right', hasOverflow && current < maxScroll - 2);
    };

    scrollWrapper.addEventListener('scroll', () => requestAnimationFrame(updateState), { passive: true });

    if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => requestAnimationFrame(updateState));
        ro.observe(scrollWrapper);
    }

    window._refreshCategoryArrows = updateState;
    requestAnimationFrame(updateState);
}

// ============================================================
// 发起组局模态框（保持不变）
// ============================================================
function initPartnerModal() {
    const modal = document.getElementById('partnerModal');
    const closeBtn = document.getElementById('closePartnerModalBtn');
    const cancelBtn = document.getElementById('cancelPartnerBtn');
    const submitBtn = document.getElementById('submitPartnerBtn');
    const form = document.getElementById('partnerForm');

    if (!modal) return;

    const scheduledRow = document.getElementById('scheduledTimeRow');
    const timeModeRow = document.getElementById('timeModeRow');

    const durationBtns = document.querySelectorAll('#durationRow .time-mode-btn');
    durationBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            durationBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _modalDuration = btn.getAttribute('data-duration');
            timeModeRow.style.display = _modalDuration === 'long' ? 'none' : 'flex';
            scheduledRow.style.display = 'none';
        });
    });

    const timeModeBtns = modal.querySelectorAll('#timeModeRow .time-mode-btn');
    timeModeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            timeModeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _modalUrgency = btn.getAttribute('data-mode');
            scheduledRow.style.display = _modalUrgency === 'scheduled' ? 'flex' : 'none';
        });
    });

    // 地点搜索自动补全
    let suggestionIndex = -1;
    const locationInput = document.getElementById('partnerLocation');
    const suggestionsBox = document.getElementById('locationSuggestions');

    const _doSearch = _debounce(async function (keyword) {
        const kw = keyword.trim();
        if (!kw) {
            suggestionsBox.style.display = 'none';
            suggestionIndex = -1;
            return;
        }
        suggestionsBox.innerHTML = '<li class="suggestion-loading">搜索中...</li>';
        suggestionsBox.style.display = 'block';

        try {
            const resp = await fetch(`${API_BASE}/places/suggestions?keyword=${encodeURIComponent(kw)}&city=${encodeURIComponent('南京')}&location=118.780,32.058`);
            const data = await resp.json();
            if (!data.tips || data.tips.length === 0) {
                suggestionsBox.innerHTML = '<li class="suggestion-empty">未找到地点，请尝试其他关键词</li>';
                suggestionsBox.style.display = 'block';
                suggestionIndex = -1;
                return;
            }
            suggestionsBox.innerHTML = data.tips.map((tip, idx) => {
                const name = escapeHtml(tip.name || '');
                const address = escapeHtml(tip.address || tip.district || '');
                return `<li data-idx="${idx}" data-location="${tip.location}" data-name="${escapeHtml(name)}">
                    <span class="suggestion-name">${name}</span>
                    <span class="suggestion-address">${address}</span>
                </li>`;
            }).join('');
            suggestionsBox.style.display = 'block';
            suggestionIndex = -1;
        } catch (err) {
            console.warn('地点搜索失败:', err);
            suggestionsBox.innerHTML = '<li class="suggestion-empty">搜索失败，请重试</li>';
            suggestionsBox.style.display = 'block';
            suggestionIndex = -1;
        }
    }, 300);

    locationInput.addEventListener('input', () => {
        _modalLocationCoords = null;
        _doSearch(locationInput.value);
    });

    suggestionsBox.addEventListener('click', (e) => {
        const li = e.target.closest('li');
        if (!li) return;
        const loc = li.getAttribute('data-location');
        const name = li.getAttribute('data-name');
        if (loc && name) {
            locationInput.value = name;
            _modalLocationCoords = loc;
            suggestionsBox.style.display = 'none';
            suggestionIndex = -1;
        }
    });

    locationInput.addEventListener('keydown', (e) => {
        const items = suggestionsBox.querySelectorAll('li[data-location]');
        if (!items.length || suggestionsBox.style.display === 'none') return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            suggestionIndex = Math.min(suggestionIndex + 1, items.length - 1);
            items.forEach((it, i) => it.classList.toggle('active', i === suggestionIndex));
            items[suggestionIndex]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            suggestionIndex = Math.max(suggestionIndex - 1, 0);
            items.forEach((it, i) => it.classList.toggle('active', i === suggestionIndex));
            items[suggestionIndex]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (suggestionIndex >= 0 && items[suggestionIndex]) {
                items[suggestionIndex].click();
            }
        } else if (e.key === 'Escape') {
            suggestionsBox.style.display = 'none';
            suggestionIndex = -1;
        }
    });

    document.addEventListener('click', (e) => {
        if (!locationInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
            suggestionsBox.style.display = 'none';
            suggestionIndex = -1;
        }
    });

    const openModal = () => {
        if (!isLoggedIn()) {
            showToast('请先登录后再发起组局');
            const authModal = document.getElementById('authModal');
            if (authModal) authModal.style.display = 'flex';
            return;
        }
        modal.removeAttribute('data-edit-id');
        form?.reset();
        _modalDuration = 'short';
        durationBtns.forEach(b => b.classList.remove('active'));
        const defaultDurationBtn = document.querySelector('#durationRow .time-mode-btn[data-duration="short"]');
        if (defaultDurationBtn) defaultDurationBtn.classList.add('active');
        if (timeModeRow) timeModeRow.style.display = 'flex';
        timeModeBtns.forEach(b => b.classList.remove('active'));
        const defaultTimeBtn = modal.querySelector('#timeModeRow .time-mode-btn[data-mode="now"]');
        if (defaultTimeBtn) defaultTimeBtn.classList.add('active');
        _modalUrgency = 'now';
        if (scheduledRow) scheduledRow.style.display = 'none';
        _modalLocationCoords = null;
        suggestionIndex = -1;
        if (suggestionsBox) suggestionsBox.style.display = 'none';
        modal.style.display = 'flex';
    };

    const closeModal = () => {
        modal.style.display = 'none';
        form?.reset();
        _modalLocationCoords = null;
        suggestionIndex = -1;
        if (suggestionsBox) suggestionsBox.style.display = 'none';
    };

    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    submitBtn?.addEventListener('click', async () => {
        const category = document.getElementById('partnerCategory')?.value;
        const title = document.getElementById('partnerTitle')?.value.trim();
        const description = document.getElementById('partnerDesc')?.value.trim();
        const location = document.getElementById('partnerLocation')?.value.trim();
        const budget = document.getElementById('partnerBudget')?.value.trim();
        const slots = parseInt(document.getElementById('partnerSlots')?.value) || 1;
        const contact = document.getElementById('partnerContact')?.value.trim();
        const editId = modal.getAttribute('data-edit-id');

        if (!category || !title) {
            showToast('请至少填写分类和标题');
            return;
        }

        if (location && !_modalLocationCoords) {
            showToast('⚠️ 请从下拉建议中选择地点，否则帖子不会显示在地图上');
        }

        let event_time = null;
        if (_modalUrgency === 'scheduled') {
            const dateVal = document.getElementById('partnerDate')?.value;
            const timeVal = document.getElementById('partnerTimePicker')?.value;
            if (!dateVal || !timeVal) {
                showToast('请选择具体的日期和时间');
                return;
            }
            event_time = new Date(`${dateVal}T${timeVal}:00`).toISOString();
        }

        const tags = [category];
        const btnText = editId ? '更新中...' : '发布中...';
        submitBtn.disabled = true;
        submitBtn.innerText = btnText;

        try {
            if (editId) {
                await updatePost(parseInt(editId), {
                    type: _modalDuration === 'long' ? 'forum' : 'event',
                    title, content: description || title, tags,
                    location: _modalLocationCoords || null,
                    location_name: location || null,
                    urgency: _modalDuration === 'long' ? 'long_term' : _modalUrgency,
                    event_time: _modalDuration === 'long' ? null : event_time,
                    slots, budget, contact,
                });
                modal.removeAttribute('data-edit-id');
                showToast('组局已更新');
            } else {
                await createPost({
                    type: _modalDuration === 'long' ? 'forum' : 'event',
                    title, content: description || title, tags,
                    location: _modalLocationCoords || null,
                    location_name: location || null,
                    urgency: _modalDuration === 'long' ? 'long_term' : _modalUrgency,
                    event_time: _modalDuration === 'long' ? null : event_time,
                    slots, budget, contact,
                });
                showToast('发布成功');
            }
            closeModal();
            // 重置分页并重新加载第一页
            currentPage = 1;
            hasMore = true;
            await loadPostsByPage(1, false);
            refreshPreviewMarkers();
        } catch (err) {
            showToast('发布失败: ' + err.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerText = '发布组局';
        }
    });

    window.openPartnerModal = openModal;
}

// ============================================================
// 滚动分页监听（触底加载更多）
// ============================================================
let scrollTimeout = null;
function handleScroll() {
    if (scrollTimeout) return;
    scrollTimeout = setTimeout(async () => {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const winHeight = window.innerHeight;
        const docHeight = document.documentElement.scrollHeight;

        if (scrollTop + winHeight >= docHeight - 300) {
            if (!isLoading && hasMore) {
                currentPage++;
                await loadPostsByPage(currentPage, true);
            }
        }
        scrollTimeout = null;
    }, 100);
}

// ============================================================
// 页面入口 & 初始化
// ============================================================
let _partnerDataLoaded = false;
let _partnerPageInitialized = false;

export async function loadPartnerData() {
    if (_partnerDataLoaded) {
        if (_currentMapParent === 'full') {
            const map = _getOrCreateSharedMap('preview');
            if (map) {
                addMarkersToMap(map, partnersData);
            }
        }
        return;
    }
    _partnerDataLoaded = true;
    initFilters();
    await loadPostsByPage(1, false);
    initPreviewMap();
}

function _ensureRightPanel() {
    const page = document.getElementById('partnerPage');
    if (!page) return;

    const container = page.querySelector('.filter-slider-container');
    const waterfall = page.querySelector('.partner-waterfall');
    if (!container || !waterfall) return;

    let panel = page.querySelector('.partner-right-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.className = 'partner-right-panel';
        page.insertBefore(panel, container);
        panel.appendChild(container);
        panel.appendChild(waterfall);
        return;
    }

    if (container.parentElement !== panel) panel.appendChild(container);
    if (waterfall.parentElement !== panel) panel.appendChild(waterfall);
}

export async function initPartnerPage() {
    initPartnerModal();
    initPostDetailModal();
    initMobileMapToggle();

    setupCategoryScrollArrows();
    _ensureRightPanel();

    const partnerPage = document.getElementById('partnerPage');
    if (partnerPage) {
        const observer = new MutationObserver(() => {
            if (partnerPage.classList.contains('active-page')) {
                setTimeout(() => window._refreshCategoryArrows?.(), 100);
            }
        });
        observer.observe(partnerPage, { attributes: true, attributeFilter: ['class'] });
    }

    if (!_partnerPageInitialized) {
        _partnerPageInitialized = true;
        window.addEventListener('resize', () => {
            initMobileMapToggle();
            setTimeout(() => window._refreshCategoryArrows?.(), 150);
        });
        // 注册滚动监听
        window.addEventListener('scroll', handleScroll);
    }
}

export { openPostDetail };

// ============================================================
// 工具函数
// ============================================================
function safeHtmlWithBreaks(str) {
    if (!str) return '';
    let safe = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    safe = safe.replace(/\n/g, '<br>');
    return safe;
}

function _debounce(fn, delay) {
    let timer = null;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// 暴露全局方法
window.initPartnerPage = initPartnerPage;
window.loadPartnerData = loadPartnerData;
window.setupCategoryScrollArrows = setupCategoryScrollArrows;
window.forceShowArrows = function() {
    document.querySelectorAll('.scroll-arrow').forEach(arrow => {
        arrow.classList.remove('is-hidden');
        arrow.style.visibility = 'visible';
        arrow.style.opacity = '1';
        arrow.style.display = 'flex';
    });
};
window.checkOverflow = function() {
    const wrapper = document.querySelector('.filter-scroll-wrapper');
    if (!wrapper) return;
    const maxScroll = wrapper.scrollWidth - wrapper.clientWidth;
    console.log('[checkOverflow]', {
        scrollWidth: wrapper.scrollWidth,
        clientWidth: wrapper.clientWidth,
        maxScroll: maxScroll,
        hasOverflow: maxScroll > 2,
        scrollLeft: wrapper.scrollLeft
    });
};