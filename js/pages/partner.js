import { showToast, formatDate, escapeHtml, wgs84ToGcj02 } from '../utils.js';
import { isLoggedIn, getUser } from '../auth.js';
import { listPosts, getPost, createPost, updatePost, deletePost, togglePostLike, addPostComment, deletePostComment, participateEvent } from '../api.js';
import { API_BASE, loadAmapScript } from '../config.js';

// ============================================================
// 全局状态
// ============================================================
let _allPartnersData = [];    // 后端全量数据缓存（只请求一次）
let partnersData = [];        // 当前显示的帖子列表（筛选后的视图）
let currentCategory = 'all';  // 当前选中的分类标签名

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
// 数据加载：从后端 API 获取帖子列表
// ============================================================
/** 首次加载：从后端拉取全量帖子，缓存到 _allPartnersData */
async function loadAllPosts() {
    if (_allPartnersData.length > 0) {
        // 已缓存，直接应用筛选
        _applyCategoryFilter();
        return _allPartnersData;
    }
    try {
        const result = await listPosts({ sort: 'hot', page_size: 100 });
        _allPartnersData = (result.items || []).map(_mapPost);
        _applyCategoryFilter();  // 初次加载后应用当前分类筛选
        return _allPartnersData;
    } catch (err) {
        console.warn('加载帖子失败，使用空列表:', err.message);
        _allPartnersData = [];
        partnersData = [];
        return [];
    }
}

/** 客户端筛选：从全量缓存中按 currentCategory 过滤到 partnersData */
function _applyCategoryFilter() {
    if (currentCategory === 'all') {
        partnersData = _allPartnersData;
    } else {
        partnersData = _allPartnersData.filter(p => p.tags.includes(currentCategory));
    }
}

/** 切换分类时调用：纯客户端筛选，无网络请求 */
function switchCategory(category) {
    if (currentCategory === category) return;
    currentCategory = category;
    _applyCategoryFilter();
    renderWaterfall();
    refreshPreviewMarkers();
}

/** 后台刷新全量数据（不改变当前筛选） */
async function _reloadAllPosts() {
    try {
        const result = await listPosts({ sort: 'hot', page_size: 100 });
        _allPartnersData = (result.items || []).map(_mapPost);
    } catch (err) {
        console.warn('刷新帖子失败:', err.message);
    }
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
        lnglat: p.location ? p.location.split(',').map(Number) : null,  // "lng,lat"
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
        nearby: '',  // 预留：后续可关联场所推荐
    };
}

function _formatPostTime(iso, urgency) {
    // urgency='now' → 显示"立即"
    if (urgency === 'now') return '立即';
    // urgency='long_term' → 显示"长期有效"
    if (urgency === 'long_term') return '长期有效';
    // scheduled 或旧数据 → 格式化具体时间
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
// 高德地图初始化
// ============================================================
async function ensureAMap() {
    if (window.AMap) return window.AMap;
    // 动态加载高德 SDK（config.js loadAmapScript 返回 Promise，已内置去重和缓存）
    try {
        await loadAmapScript();
        if (window.AMap) return window.AMap;
        throw new Error('AMap SDK 加载后 window.AMap 仍然不可用');
    } catch (err) {
        console.warn('高德地图加载失败:', err.message);
        throw err;
    }
}

/**
 * 获取或创建共享地图实例。
 * 整个页面只存在一个 AMap.Map，通过移动其 DOM 容器在预览区和全屏区之间切换。
 * @param {'preview'|'full'} targetParent - 地图要显示在哪个容器
 * @returns {object|null} AMap.Map 实例
 */
function _getOrCreateSharedMap(targetParent) {
    const containerId = targetParent === 'full' ? 'fullMap' : 'previewMap';
    const target = document.getElementById(containerId);
    if (!target) return null;

    // 如果地图已存在且在同一容器 → 直接返回
    if (_sharedMap && _currentMapParent === targetParent) {
        return _sharedMap;
    }

    const center = _getMapCenter();

    if (!_sharedMap) {
        // 首次创建：在可移动的 wrapper div 内实例化地图
        _sharedMapContainer = document.createElement('div');
        _sharedMapContainer.style.cssText = 'width:100%;height:100%;';
        target.innerHTML = '';
        target.appendChild(_sharedMapContainer);

        _sharedMap = new window.AMap.Map(_sharedMapContainer, {
            zoom: 15,
            center: center,
            mapStyle: 'amap://styles/light',
            resizeEnable: false,  // 由我们手动 throttle resize
        });
        _currentMapParent = targetParent;
        _setupResizeObserver();
    } else {
        // 地图已存在但容器不同 → 移动 wrapper div 到新容器
        target.innerHTML = '';
        target.appendChild(_sharedMapContainer);
        _currentMapParent = targetParent;
        // 容器尺寸变化后通知地图重新计算布局
        _sharedMap.resize();
        // 重新绑定 ResizeObserver（部分浏览器在 reparent 后需要）
        if (_resizeObserver && _sharedMapContainer) {
            _resizeObserver.unobserve(_sharedMapContainer);
            _resizeObserver.observe(_sharedMapContainer);
        }
    }

    return _sharedMap;
}

/** 销毁共享地图实例（页面卸载时调用） */
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

// 手动 throttle resize：替代 Amap 内置的 resizeEnable（已关闭），
// 用 ResizeObserver + 300ms debounce 在容器尺寸真正变化时才触发 map.resize()
let _resizeObserver = null;
let _resizeTimer = null;

function _setupResizeObserver() {
    if (_resizeObserver) return;
    if (!window.ResizeObserver) return; // 旧浏览器回退
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

// marker 图标缓存：按颜色复用 AMap.Icon，避免每个标记都创建新的 SVG data URI
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

// 延迟初始化 — window.AMap 在模块加载时尚未可用，需在 SDK 加载后创建
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

// 共享 InfoWindow 实例：避免每次点击标记都创建新的 InfoWindow 对象
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

    // 批量创建标记，一次性添加到地图以减少重绘次数
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

    // 一次性批量添加到地图，替代逐个 setMap 减少重绘
    if (markers.length > 0) {
        map.add(markers);
    }
    return markers;
}

// 事件委托：统一处理地图 InfoWindow 中的「我要参加」按钮点击
// 替代每个 marker 的 setTimeout + addEventListener，更高效且不会有时序问题
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.map-join-btn');
    if (!btn) return;
    const postId = parseInt(btn.getAttribute('data-post-id'));
    if (postId) handleParticipate(postId);
});

// ============================================================
// 地图初始化入口
// ============================================================
async function initPreviewMap() {
    try {
        // 1. 立即触发 SDK 脚本下载（网络 I/O，不阻塞主线程）
        await ensureAMap();
        // 2. 将 CPU 密集的地图实例化推迟到浏览器空闲时
        await new Promise((resolve) => {
            const doInit = () => {
                try {
                    const map = _getOrCreateSharedMap('preview');
                    if (map) {
                        const filtered = currentCategory === 'all'
                            ? partnersData
                            : partnersData.filter(p => p.tags.includes(currentCategory));
                        addMarkersToMap(map, filtered);
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
    // 只有地图在预览区时才刷新标记；否则等切回预览时自然刷新
    if (_currentMapParent !== 'preview') return;
    const map = _sharedMap;
    if (!map) {
        await initPreviewMap();
        return;
    }
    const filtered = currentCategory === 'all'
        ? partnersData
        : partnersData.filter(p => p.tags.includes(currentCategory));
    addMarkersToMap(map, filtered);
}

// ============================================================
// 全屏地图
// ============================================================
async function initFullMapMarkers() {
    try {
        await ensureAMap();
        const container = document.getElementById('fullMap');
        if (!container || container.offsetWidth === 0) {
            await new Promise(r => setTimeout(r, 200));
        }
        // 将 CPU 密集的地图实例化推迟到浏览器空闲时
        await new Promise((resolve) => {
            const doInit = () => {
                try {
                    // 复用共享地图实例，将其从预览区移动到全屏区
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
// 瀑布流卡片渲染
// ============================================================
function renderWaterfall() {
    const container = document.getElementById('partnerWaterfall');
    if (!container) return;

    const filtered = currentCategory === 'all'
        ? partnersData
        : partnersData.filter(p => p.tags.includes(currentCategory));

    if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-tertiary);grid-column:1/-1;">暂无组局，快来发起第一个吧~</div>';
        return;
    }

    container.innerHTML = filtered.map((p) => `
        <article class="partner-card partner-brief-card" data-id="${p.id}">
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
                        <button class="join-btn owner-delete-btn" data-id="${p.id}">
                            🗑️ 删除活动
                        </button>
                    ` : (p.type === 'event' && p.members >= p.slots && p.participationStatus !== 'going') ? `
                        <button class="join-btn" disabled style="opacity:0.5;cursor:not-allowed;">
                            🚫 已满员
                        </button>
                    ` : `
                        <button class="join-btn" data-id="${p.id}">
                            ${p.participationStatus === 'going' ? '✅ 已报名·点此取消' : '我要参加'}
                        </button>
                    `}
                </div>
            </div>
        </article>
    `).join('');

    // 发起者「删除活动」按钮
    container.querySelectorAll('.owner-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            _deletePostCard(parseInt(btn.getAttribute('data-id')));
        });
    });

    // 「参加」按钮（非发起者）
    container.querySelectorAll('.join-btn:not(.owner-delete-btn)').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleParticipate(parseInt(btn.getAttribute('data-id')));
        });
    });

    // 卡片点击 → 打开帖子详情
    container.querySelectorAll('.partner-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            const pid = parseInt(card.getAttribute('data-id'));
            if (pid) openPostDetail(pid);
        });
    });
}

// ============================================================
// 参与活动（"上车" / "我要参加"）
// ============================================================
/** 直接更新单个卡片的 DOM，避免全量 renderWaterfall 重建 */
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
        // 即时更新受影响的单张卡片 DOM，不触发全量重建
        const post = _allPartnersData.find(p => p.id === postId) || partnersData.find(p => p.id === postId);
        _updateSingleCardDOM(postId, result.status, post?.members || 0, post?.slots || 1);
        // 后台静默刷新全量数据并重渲染（fire-and-forget，不阻塞用户交互）
        const latestStatus = result.status ?? null;
        _reloadAllPosts().then(() => {
            const updated = _allPartnersData.find(p => p.id === postId) || partnersData.find(p => p.id === postId);
            if (updated && latestStatus === 'going' && updated.participationStatus !== 'going') {
                updated.participationStatus = latestStatus;
            }
            _applyCategoryFilter();
            renderWaterfall();
            refreshPreviewMarkers();
        }).catch(() => {});
    } catch (err) {
        showToast('操作失败: ' + err.message);
    }
}

function _applyParticipationResult(postId, result) {
    const post = partnersData.find(p => p.id === postId);
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

/** 从卡片直接删除帖子（仅发起者可见此操作） */
async function _deletePostCard(postId) {
    if (!confirm('⚠️ 确定要删除这条组局吗？\n\n此操作不可撤销，所有评论和报名数据将被永久删除。')) return;
    try {
        await deletePost(postId);
        showToast('已删除');
        await _reloadAllPosts();
        _applyCategoryFilter();
        renderWaterfall();
        refreshPreviewMarkers();
    } catch (err) {
        showToast('删除失败: ' + err.message);
    }
}

// ============================================================
// 帖子详情模态框
// ============================================================
let currentDetailPost = null;  // 当前打开的帖子数据

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

    // 点赞（乐观更新：先改 UI，再发请求，失败回滚）
    likeBtn?.addEventListener('click', async () => {
        if (!currentDetailPost) return;
        if (!isLoggedIn()) { showToast('请先登录'); return; }
        // 乐观更新：立即翻转 UI
        const prevLiked = currentDetailPost.is_liked;
        const prevCount = currentDetailPost.like_count || 0;
        currentDetailPost.is_liked = !prevLiked;
        currentDetailPost.like_count = prevLiked ? prevCount - 1 : prevCount + 1;
        _updateDetailStats();
        likeBtn.classList.toggle('liked', currentDetailPost.is_liked);
        likeBtn.textContent = currentDetailPost.is_liked ? '已点赞' : '点赞';
        try {
            const result = await togglePostLike(currentDetailPost.id);
            // 用服务端真实数据修正
            currentDetailPost.is_liked = result.liked;
            currentDetailPost.like_count = result.like_count;
            _updateDetailStats();
            likeBtn.classList.toggle('liked', result.liked);
            likeBtn.textContent = result.liked ? '已点赞' : '点赞';
        } catch (err) {
            // 失败回滚
            currentDetailPost.is_liked = prevLiked;
            currentDetailPost.like_count = prevCount;
            _updateDetailStats();
            likeBtn.classList.toggle('liked', prevLiked);
            likeBtn.textContent = prevLiked ? '已点赞' : '点赞';
            showToast('操作失败: ' + err.message);
        }
    });

    // 报名（乐观更新 + 后台刷新列表）
    participateBtn?.addEventListener('click', async () => {
        if (!currentDetailPost) return;
        if (!isLoggedIn()) { showToast('请先登录'); return; }
        // 乐观更新：立即翻转按钮和计数
        const prevStatus = currentDetailPost.participation_status;
        const prevCount = currentDetailPost.participant_count || 0;
        const newStatus = prevStatus === 'going' ? null : 'going';
        currentDetailPost.participation_status = newStatus;
        currentDetailPost.participant_count = newStatus === 'going' ? prevCount + 1 : Math.max(0, prevCount - 1);
        _updateDetailStats();
        participateBtn.textContent = newStatus === 'going' ? '已报名，点击取消' : '我要参加';
        participateBtn.classList.toggle('going', newStatus === 'going');
        // 乐观追加/移除当前用户到参与者列表
        const user = getUser();
        if (user && user.username) {
            _optimisticUpdateParticipants(newStatus, user);
        }
        try {
            const result = await participateEvent(currentDetailPost.id, 'going');
            // 用服务端真实数据修正
            currentDetailPost.participation_status = result.status;
            currentDetailPost.participant_count = result.participant_count;
            _applyParticipationResult(currentDetailPost.id, result);
            _updateDetailStats();
            const going = result.status === 'going';
            participateBtn.textContent = going ? '已报名，点击取消' : '我要参加';
            participateBtn.classList.toggle('going', going);
            // 后台静默刷新参与者列表（fire-and-forget，不阻塞用户）
            _refreshDetailParticipants(currentDetailPost.id);
            // 后台更新卡片列表和地图（不阻塞）
            _deferredWaterfallAndMapRefresh();
        } catch (err) {
            // 失败回滚
            currentDetailPost.participation_status = prevStatus;
            currentDetailPost.participant_count = prevCount;
            _updateDetailStats();
            participateBtn.textContent = prevStatus === 'going' ? '已报名，点击取消' : '我要参加';
            participateBtn.classList.toggle('going', prevStatus === 'going');
            _revertOptimisticParticipants(prevStatus, user);
            showToast('操作失败: ' + err.message);
        }
    });

    // 发表评论
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

    // 编辑自己的帖子
    document.getElementById('detailEditBtn')?.addEventListener('click', () => {
        if (!currentDetailPost) return;
        _openEditPostModal(currentDetailPost);
    });

    // 删除自己的帖子
    document.getElementById('detailDeleteBtn')?.addEventListener('click', async () => {
        if (!currentDetailPost) return;
        if (!confirm('确定要删除这条组局吗？此操作不可撤销。')) return;
        try {
            await deletePost(currentDetailPost.id);
            showToast('已删除');
            document.getElementById('postDetailModal').style.display = 'none';
            currentDetailPost = null;
            // 重新加载列表
            await _reloadAllPosts();
            _applyCategoryFilter();
            renderWaterfall();
            refreshPreviewMarkers();
        } catch (err) {
            showToast('删除失败: ' + err.message);
        }
    });
}

/** 打开编辑帖子弹窗（复用发布模态框）。
 *  post 是 getPost() API 返回的原始数据：
 *    { type, title, content, tags, urgency, event_time, location, location_name, ... }
 */
function _openEditPostModal(post) {
    const modal = document.getElementById('partnerModal');
    if (!modal) return;
    document.getElementById('postDetailModal').style.display = 'none';

    // ── 1. 预填表单字段（使用原始 API 字段名）──
    document.getElementById('partnerCategory').value = (post.tags && post.tags[0]) ? post.tags[0] : '';
    document.getElementById('partnerTitle').value = post.title || '';
    document.getElementById('partnerDesc').value = post.content || '';
    document.getElementById('partnerLocation').value = post.location_name || '';
    document.getElementById('partnerBudget').value = post.budget || '';
    document.getElementById('partnerSlots').value = post.max_participants || 1;
    document.getElementById('partnerContact').value = post.contact || '';

    // ── 2. 恢复时长类型 UI ──
    _modalDuration = (post.type === 'forum') ? 'long' : 'short';
    const durationBtns = document.querySelectorAll('#durationRow .time-mode-btn');
    durationBtns.forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-duration') === _modalDuration);
    });
    const timeModeRow = document.getElementById('timeModeRow');
    if (timeModeRow) timeModeRow.style.display = _modalDuration === 'long' ? 'none' : 'flex';

    // ── 3. 恢复时间模式 UI ──
    _modalUrgency = (post.urgency === 'scheduled') ? 'scheduled' : 'now';
    const timeModeBtns = document.querySelectorAll('#timeModeRow .time-mode-btn');
    timeModeBtns.forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-mode') === _modalUrgency);
    });
    const scheduledRow = document.getElementById('scheduledTimeRow');
    if (scheduledRow) {
        scheduledRow.style.display = _modalUrgency === 'scheduled' ? 'flex' : 'none';
    }
    // 预填日期时间
    if (post.event_time) {
        const d = new Date(post.event_time);
        document.getElementById('partnerDate').value = d.toISOString().split('T')[0];
        const time = d.toTimeString().split(' ')[0].substring(0, 5);
        document.getElementById('partnerTimePicker').value = time;
    }

    // ── 4. 恢复地点坐标 ──
    _modalLocationCoords = post.location || null;  // "lng,lat" 字符串

    // ── 5. 标记编辑模式并打开 ──
    modal.setAttribute('data-edit-id', post.id);
    modal.style.display = 'flex';
}

/** 将列表缓存数据映射为 _renderPostDetail 兼容的格式（用于即时渲染） */
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
        _fromCache: true,  // 标记为缓存数据，评论/参与者待加载
    };
}

/** 打开帖子详情 */
async function openPostDetail(postId) {
    const modal = document.getElementById('postDetailModal');
    if (!modal) return;

    modal.style.display = 'flex';
    _resetDetailUI();

    // ── 即时渲染：优先用列表缓存数据展示主体内容 ──
    const cached = partnersData.find(p => p.id === postId);
    if (cached) {
        const quick = _mapCachedToDetailFormat(cached);
        _renderPostDetail(quick);
        // 标记评论和参与者正在加载
        document.getElementById('detailComments').innerHTML = '<div class="detail-comments-empty">加载评论中...</div>';
    }

    // ── 异步拉取完整数据（评论 + 参与者 + 最新状态）──
    try {
        const post = await getPost(postId);
        currentDetailPost = post;
        _renderPostDetail(post);
    } catch (err) {
        if (!cached) {
            // 没有缓存数据时才完全关闭
            showToast('加载帖子详情失败: ' + err.message);
            modal.style.display = 'none';
            currentDetailPost = null;
        } else {
            // 有缓存数据时保持展示，仅提示刷新失败
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
    // 头部
    document.getElementById('detailTitle').textContent = post.title;
    document.getElementById('detailBody').innerHTML = safeHtmlWithBreaks(post.content || '');

    // 标签
    const tags = post.tags || [];
    document.getElementById('detailTags').innerHTML = tags.map(t =>
        `<span class="post-detail-tag">${escapeHtml(t)}</span>`
    ).join('');

    // 元信息
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

    // 统计
    _updateDetailStats(post);
    // 人数显示为 "已报名/上限"
    const slots = post.max_participants || 1;
    document.getElementById('detailParticipantCount').textContent = `${post.participant_count || 0}/${slots}人`;

    // 操作按钮
    const likeBtn = document.getElementById('detailLikeBtn');
    // 先重置再设置，兼容 _renderPostDetail 被多次调用（缓存→API）
    likeBtn.classList.remove('liked');
    likeBtn.textContent = '点赞';
    if (post.is_liked) {
        likeBtn.classList.add('liked');
        likeBtn.textContent = '已点赞';
    }

    // 报名按钮（非自己的帖子都能报名）
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

    // 报名用户
    _renderDetailParticipants(post.participants || []);

    // 评论
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

/** 乐观追加当前用户到参与者列表 DOM */
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
        // 取消报名：移除之前乐观添加的 chip
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

/** 回滚乐观参与者更新 */
function _revertOptimisticParticipants(prevStatus, user) {
    const container = document.getElementById('detailParticipants');
    if (!container) return;
    if (prevStatus !== 'going') {
        // 乐观加上的，需要移除
        const chip = container.querySelector(`[data-optimistic-user="${user.username}"]`);
        if (chip) chip.remove();
    } else {
        // 乐观移除的，需要加回来
        const chip = document.createElement('span');
        chip.className = 'participant-chip';
        chip.innerHTML = `${escapeHtml(user.username || '用户')}<span class="participant-status">确定</span>`;
        container.appendChild(chip);
    }
}

/** 后台延迟刷新瀑布流和地图（fire-and-forget，不阻塞用户交互） */
let _deferredRefreshTimer = null;
function _deferredWaterfallAndMapRefresh() {
    clearTimeout(_deferredRefreshTimer);
    _deferredRefreshTimer = setTimeout(() => {
        renderWaterfall();
        refreshPreviewMarkers();
    }, 500);
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

    // 回复按钮
    container.querySelectorAll('.detail-comment-reply-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const commentId = parseInt(btn.getAttribute('data-comment-id'));
            _showReplyInput(btn.closest('.detail-comment'), commentId);
        });
    });

    // 删除评论按钮
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
    // 避免重复
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
// 分类筛选（动态生成，基于后端标签）
// ============================================================
// 固定搭子分类（不再从后端动态拉取标签作为筛选项）
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
        chip.addEventListener('click', () => {
            const category = chip.getAttribute('data-category');
            container.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            switchCategory(category);  // 纯客户端筛选，无网络请求
        });
    });
}

// ============================================================
// 发布搭子模态框
// ============================================================
function initPartnerModal() {
    const modal = document.getElementById('partnerModal');
    const closeBtn = document.getElementById('closePartnerModalBtn');
    const cancelBtn = document.getElementById('cancelPartnerBtn');
    const submitBtn = document.getElementById('submitPartnerBtn');
    const form = document.getElementById('partnerForm');

    if (!modal) return;

    // 时长类型 + 时间模式联动（使用模块级变量，以便 _openEditPostModal 访问）
    const scheduledRow = document.getElementById('scheduledTimeRow');
    const timeModeRow = document.getElementById('timeModeRow');

    // 长期/短期切换
    const durationBtns = document.querySelectorAll('#durationRow .time-mode-btn');
    durationBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            durationBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _modalDuration = btn.getAttribute('data-duration');
            // 长期 → 隐藏时间行；短期 → 显示时间行
            timeModeRow.style.display = _modalDuration === 'long' ? 'none' : 'flex';
            scheduledRow.style.display = 'none';  // 切换时长时重置指定时间行
        });
    });

    // 短期时间模式切换（立即 / 指定）
    const timeModeBtns = modal.querySelectorAll('#timeModeRow .time-mode-btn');
    timeModeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            timeModeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _modalUrgency = btn.getAttribute('data-mode');
            scheduledRow.style.display = _modalUrgency === 'scheduled' ? 'flex' : 'none';
        });
    });

    // ── 地点搜索自动补全（后端代理高德 inputtips）──
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

    // 输入时触发搜索
    locationInput.addEventListener('input', () => {
        _modalLocationCoords = null;
        _doSearch(locationInput.value);
    });

    // 点击建议项
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

    // 键盘导航
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

    // 点击外部关闭下拉
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
        // 清除编辑模式
        modal.removeAttribute('data-edit-id');
        form?.reset();
        // 重置时长类型为短期
        _modalDuration = 'short';
        durationBtns.forEach(b => b.classList.remove('active'));
        const defaultDurationBtn = document.querySelector('#durationRow .time-mode-btn[data-duration="short"]');
        if (defaultDurationBtn) defaultDurationBtn.classList.add('active');
        if (timeModeRow) timeModeRow.style.display = 'flex';
        // 重置时间模式为立即
        timeModeBtns.forEach(b => b.classList.remove('active'));
        const defaultTimeBtn = modal.querySelector('#timeModeRow .time-mode-btn[data-mode="now"]');
        if (defaultTimeBtn) defaultTimeBtn.classList.add('active');
        _modalUrgency = 'now';
        if (scheduledRow) scheduledRow.style.display = 'none';
        // 重置地点搜索状态
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

        // 地点填了但未从下拉选中 → 提醒但不阻塞
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
            await _reloadAllPosts();
            _applyCategoryFilter();
            renderWaterfall();
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
// 页面入口
// ============================================================
let _partnerDataLoaded = false;

export async function initPartnerPage() {
    // 纯事件绑定，不依赖任何数据，立即执行（仅首次）
    initPartnerModal();
    initPostDetailModal();

    // 桌面端：使用 grid 布局
    _ensureRightPanel();
}

/** 加载找搭子数据（仅在首次进入找搭子页面时调用） */
export async function loadPartnerData() {
    if (_partnerDataLoaded) {
        // 从全屏地图返回时：将共享地图移回预览区并刷新标记
        if (_currentMapParent === 'full') {
            const map = _getOrCreateSharedMap('preview');
            if (map) {
                const filtered = currentCategory === 'all'
                    ? partnersData
                    : partnersData.filter(p => p.tags.includes(currentCategory));
                addMarkersToMap(map, filtered);
            }
        }
        return;
    }
    _partnerDataLoaded = true;

    initFilters();  // 同步设置固定分类 chips
    await loadAllPosts();  // 首次加载全量数据并缓存
    renderWaterfall();

    initPreviewMap();
}

/** 桌面端用右侧面板包裹 filter + waterfall，配合 grid 布局（display: contents 让子元素参与父级 grid） */
function _ensureRightPanel() {
    const page = document.getElementById('partnerPage');
    if (!page) return;
    // 避免重复包裹
    if (page.querySelector('.partner-right-panel')) return;
    const panel = document.createElement('div');
    panel.className = 'partner-right-panel';
    const filter = page.querySelector('.partner-filter');
    const waterfall = page.querySelector('.partner-waterfall');
    if (filter && waterfall) {
        filter.parentNode.insertBefore(panel, filter);
        panel.appendChild(filter);
        panel.appendChild(waterfall);
    }
}

// 导出供其他模块使用（地图标记点击等）
export { openPostDetail };
// ============================================================
// 工具函数
// ============================================================
/** 安全渲染文本为 HTML：保留 emoji 和所有 Unicode，转换换行为 <br> */
function safeHtmlWithBreaks(str) {
    if (!str) return '';
    // 先转义 HTML 特殊字符（保留 emoji 等多字节 Unicode）
    let safe = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // 换行转 <br>，保留连续空白
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
