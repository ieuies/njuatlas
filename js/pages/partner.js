import { showToast, formatDate, wgs84ToGcj02 } from '../utils.js';
import { isLoggedIn, getUser } from '../auth.js';
import { listPosts, getPost, createPost, updatePost, deletePost, togglePostLike, addPostComment, deletePostComment, participateEvent, listTags } from '../api.js';
import { API_BASE } from '../config.js';

// ============================================================
// 全局状态
// ============================================================
let partnersData = [];       // 当前显示的帖子列表（来自后端 API）
let allTags = [];            // 后端返回的所有标签
let currentCategory = 'all'; // 当前选中的分类标签名

// 高德地图实例
let previewMap = null;
let fullMapInstance = null;

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

// ============================================================
// 数据加载：从后端 API 获取帖子列表
// ============================================================
async function loadPostsFromAPI() {
    try {
        const params = { sort: 'hot', page_size: 100 };
        if (currentCategory !== 'all') {
            params.tags = currentCategory;  // 后端 AND 匹配
        }
        const result = await listPosts(params);
        partnersData = (result.items || []).map(_mapPost);
        return partnersData;
    } catch (err) {
        console.warn('加载帖子失败，使用空列表:', err.message);
        partnersData = [];
        return [];
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
        slots: 0,  // 后端暂无人数上限字段，预留
        likeCount: p.like_count || 0,
        commentCount: p.comment_count || 0,
        hotScore: p.hot_score || 0,
        isLiked: p.is_liked || false,
        isOwner: p.is_owner || false,
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
    return new Promise((resolve, reject) => {
        let elapsed = 0;
        const check = setInterval(() => {
            if (window.AMap) {
                clearInterval(check);
                resolve(window.AMap);
            }
            elapsed += 100;
            if (elapsed > 5000) {
                clearInterval(check);
                reject(new Error('AMap script loading timeout'));
            }
        }, 100);
    });
}

function createMapInstance(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return null;
    container.innerHTML = '';

    // 默认中心：南京大学鼓楼校区
    const center = wgs84ToGcj02(118.780, 32.058);

    return new window.AMap.Map(containerId, {
        zoom: 15,
        center: center,
        mapStyle: 'amap://styles/light',
        resizeEnable: true,
    });
}

function addMarkersToMap(map, data) {
    map.clearMap();
    if (!data.length) return [];

    const markers = [];
    data.forEach(post => {
        // 优先用后端返回的 GCJ-02 坐标；没有坐标的帖子不画在地图上
        const coords = post.lnglat;
        if (!coords || coords.length < 2 || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) {
            return;
        }
        const style = _categoryStyle(post.category);

        const marker = new window.AMap.Marker({
            position: coords,
            title: post.title,
            icon: new window.AMap.Icon({
                size: new window.AMap.Size(32, 32),
                image: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='12' fill='${encodeURIComponent(style.color)}' stroke='white' stroke-width='3' /%3E%3C/svg%3E`,
                imageSize: new window.AMap.Size(32, 32),
            }),
            offset: new window.AMap.Pixel(-16, -16),
            zIndex: 100,
        });

        marker.on('click', () => {
            const infoContent = `
                <div class="amap-info-content" style="max-width:240px;font-size:0.85rem;">
                    <strong style="color:${style.color};">${escapeHtml(post.category)}</strong>
                    <div style="font-weight:700;margin:4px 0;">${escapeHtml(post.title)}</div>
                    <div style="color:#666;">${escapeHtml(post.description).substring(0, 80)}</div>
                    ${post.time ? `<div>时间：${escapeHtml(post.time)}</div>` : ''}
                    <button id="map-join-${post.id}" style="margin-top:8px;padding:6px 14px;background:#6B21A5;color:white;border:none;border-radius:12px;cursor:pointer;font-size:0.8rem;">我要参加</button>
                </div>
            `;
            const infoWindow = new window.AMap.InfoWindow({
                content: infoContent,
                offset: new window.AMap.Pixel(0, -36),
            });
            infoWindow.open(map, coords);

            // 绑定「我要参加」按钮
            setTimeout(() => {
                const btn = document.getElementById(`map-join-${post.id}`);
                if (btn) {
                    btn.addEventListener('click', () => handleParticipate(post.id));
                }
            }, 100);
        });

        marker.setMap(map);
        markers.push(marker);
    });

    return markers;
}

// ============================================================
// 地图初始化入口
// ============================================================
async function initPreviewMap() {
    try {
        await ensureAMap();
        if (!previewMap) {
            previewMap = createMapInstance('previewMap');
        }
        if (previewMap) {
            const filtered = currentCategory === 'all'
                ? partnersData
                : partnersData.filter(p => p.tags.includes(currentCategory));
            addMarkersToMap(previewMap, filtered);
        }
    } catch (err) {
        console.warn('预览地图初始化失败:', err);
    }
}

async function refreshPreviewMarkers() {
    if (!previewMap) {
        await initPreviewMap();
        return;
    }
    const filtered = currentCategory === 'all'
        ? partnersData
        : partnersData.filter(p => p.tags.includes(currentCategory));
    addMarkersToMap(previewMap, filtered);
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
        if (!fullMapInstance) {
            fullMapInstance = createMapInstance('fullMap');
        }
        if (fullMapInstance) {
            addMarkersToMap(fullMapInstance, partnersData);
            setTimeout(() => fullMapInstance?.resize(), 100);
        }
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
                    ${p.time ? `<span><b>时间</b><em>${escapeHtml(p.time)}</em></span>` : ''}
                    <span><b>发起人</b><em>${escapeHtml(p.publisher)}${p.isOwner ? ' 👑' : ''}</em></span>
                </div>
                <div class="partner-card-footer">
                    <div class="partner-card-stats">
                        <span>👍 ${p.likeCount}</span>
                        <span>💬 ${p.commentCount}</span>
                        <span>👥 ${p.members}</span>
                    </div>
                    ${p.isOwner ? `
                        <button class="join-btn owner-delete-btn" data-id="${p.id}">
                            🗑️ 删除活动
                        </button>
                    ` : `
                        <button class="join-btn" data-id="${p.id}">
                            ${p.type === 'event' ? (p.participationStatus === 'going' ? '✅ 已报名·点此取消' : '我要参加') : (p.participationStatus === 'going' ? '✅ 已关注·点此取消' : '感兴趣')}
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
async function handleParticipate(postId) {
    if (!isLoggedIn()) {
        showToast('请先登录');
        const authModal = document.getElementById('authModal');
        if (authModal) authModal.style.display = 'flex';
        return;
    }
    try {
        const result = await participateEvent(postId, 'going');
        if (result.status === 'going') {
            showToast('报名成功');
        } else if (result.status === null) {
            showToast('已取消报名');
        }
        // 刷新本地数据
        await loadPostsFromAPI();
        renderWaterfall();
        refreshPreviewMarkers();
    } catch (err) {
        showToast('操作失败: ' + err.message);
    }
}

/** 从卡片直接删除帖子（仅发起者可见此操作） */
async function _deletePostCard(postId) {
    if (!confirm('⚠️ 确定要删除这条组局吗？\n\n此操作不可撤销，所有评论和报名数据将被永久删除。')) return;
    try {
        await deletePost(postId);
        showToast('已删除');
        partnersData = await loadPostsFromAPI();
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

    // 点赞
    likeBtn?.addEventListener('click', async () => {
        if (!currentDetailPost) return;
        if (!isLoggedIn()) { showToast('请先登录'); return; }
        try {
            const result = await togglePostLike(currentDetailPost.id);
            currentDetailPost.is_liked = result.liked;
            currentDetailPost.like_count = result.like_count;
            _updateDetailStats();
            likeBtn.classList.toggle('liked', result.liked);
            likeBtn.textContent = result.liked ? '已点赞' : '点赞';
        } catch (err) {
            showToast('操作失败: ' + err.message);
        }
    });

    // 报名
    participateBtn?.addEventListener('click', async () => {
        if (!currentDetailPost || currentDetailPost.type !== 'event') return;
        if (!isLoggedIn()) { showToast('请先登录'); return; }
        try {
            const result = await participateEvent(currentDetailPost.id, 'going');
            currentDetailPost.participation_status = result.status;
            currentDetailPost.participant_count = result.participant_count;
            _updateDetailStats();
            const going = result.status === 'going';
            participateBtn.textContent = going ? '已报名，点击取消' : '我要参加';
            participateBtn.classList.toggle('going', going);
            // 刷新报名列表
            await _refreshDetailParticipants(currentDetailPost.id);
        } catch (err) {
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
            const { deletePost } = await import('../api.js');
            await deletePost(currentDetailPost.id);
            showToast('已删除');
            document.getElementById('postDetailModal').style.display = 'none';
            currentDetailPost = null;
            // 重新加载列表
            partnersData = await loadPostsFromAPI();
            renderWaterfall();
            refreshPreviewMarkers();
        } catch (err) {
            showToast('删除失败: ' + err.message);
        }
    });
}

/** 打开编辑帖子弹窗（复用发布模态框） */
function _openEditPostModal(post) {
    const modal = document.getElementById('partnerModal');
    if (!modal) return;
    document.getElementById('postDetailModal').style.display = 'none';
    // 预填数据
    document.getElementById('partnerCategory').value = post.category || '';
    document.getElementById('partnerTitle').value = post.title || '';
    document.getElementById('partnerDesc').value = post.description || '';
    document.getElementById('partnerLocation').value = post.location || '';
    document.getElementById('partnerSlots').value = post.slots || 1;
    document.getElementById('partnerContact').value = post.contact || '';
    // 标记为编辑模式
    modal.setAttribute('data-edit-id', post.id);
    modal.style.display = 'flex';
}

/** 打开帖子详情 */
async function openPostDetail(postId) {
    const modal = document.getElementById('postDetailModal');
    if (!modal) return;

    modal.style.display = 'flex';
    // 清空旧数据防止闪烁
    _resetDetailUI();

    try {
        const post = await getPost(postId);
        currentDetailPost = post;
        _renderPostDetail(post);
    } catch (err) {
        showToast('加载帖子详情失败: ' + err.message);
        modal.style.display = 'none';
        currentDetailPost = null;
    }
}

function _resetDetailUI() {
    document.getElementById('detailTitle').textContent = '加载中...';
    document.getElementById('detailBody').textContent = '';
    document.getElementById('detailTags').innerHTML = '';
    document.getElementById('detailPublisher').textContent = '';
    document.getElementById('detailTime').textContent = '';
    document.getElementById('detailLocation').textContent = '';
    document.getElementById('detailComments').innerHTML = '';
    document.getElementById('detailParticipants').innerHTML = '';
    document.getElementById('detailParticipantsSection').style.display = 'none';
    document.getElementById('detailParticipateBtn').style.display = 'none';
    document.getElementById('detailLikeBtn').classList.remove('liked');
    document.getElementById('detailLikeBtn').textContent = '点赞';
    document.getElementById('detailParticipateBtn').textContent = '我要参加';
    document.getElementById('detailParticipateBtn').classList.remove('going');
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

    // 统计
    _updateDetailStats();

    // 操作按钮
    const likeBtn = document.getElementById('detailLikeBtn');
    if (post.is_liked) {
        likeBtn.classList.add('liked');
        likeBtn.textContent = '已点赞';
    }

    // 活动帖显示报名按钮（非自己的帖子才能报名）
    const participateBtn = document.getElementById('detailParticipateBtn');
    const ownerActions = document.getElementById('detailOwnerActions');
    if (post.is_owner) {
        participateBtn.style.display = 'none';
        if (ownerActions) ownerActions.style.display = 'flex';
    } else {
        if (post.type === 'event') {
            participateBtn.style.display = 'block';
            const going = post.participation_status === 'going';
            participateBtn.textContent = going ? '已报名，点击取消' : '我要参加';
            participateBtn.classList.toggle('going', going);
        }
        if (ownerActions) ownerActions.style.display = 'none';
    }

    // 报名用户
    _renderDetailParticipants(post.participants || []);

    // 评论
    _renderDetailComments(post.comments || { items: [] });
}

function _updateDetailStats() {
    const post = currentDetailPost;
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

function _renderDetailComments(commentsData) {
    const items = commentsData.items || [];
    const container = document.getElementById('detailComments');
    document.getElementById('detailCommentTotal').textContent = commentsData.total || items.length;

    if (!items.length) {
        container.innerHTML = '<div class="detail-comments-empty">暂无评论，来抢沙发吧~</div>';
        return;
    }

    container.innerHTML = items.map(c => `
        <div class="detail-comment" data-comment-id="${c.id}">
            <div class="detail-comment-header">
                <span class="detail-comment-user">${escapeHtml(c.username || '用户')}${c.is_owner ? ' <span class="comment-owner-badge">作者</span>' : ''}</span>
                <span class="detail-comment-time">${formatDate(c.created_at)}</span>
            </div>
            <div class="detail-comment-body">${escapeHtml(c.content)}</div>
            <div class="detail-comment-actions">
                <button class="detail-comment-reply-btn" data-comment-id="${c.id}">回复</button>
                ${c.is_owner ? `<button class="detail-comment-delete-btn" data-comment-id="${c.id}" title="删除评论">🗑️</button>` : ''}
            </div>
            ${(c.replies && c.replies.length) ? `
                <div class="detail-comment-replies">
                    ${c.replies.map(r => `
                        <div class="detail-comment" data-comment-id="${r.id}">
                            <div class="detail-comment-header">
                                <span class="detail-comment-user">${escapeHtml(r.username || '用户')}${r.is_owner ? ' <span class="comment-owner-badge">作者</span>' : ''}</span>
                                <span class="detail-comment-time">${formatDate(r.created_at)}</span>
                            </div>
                            <div class="detail-comment-body">${escapeHtml(r.content)}</div>
                            <div class="detail-comment-actions">
                                ${r.is_owner ? `<button class="detail-comment-delete-btn" data-comment-id="${r.id}" title="删除回复">🗑️</button>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
        </div>
    `).join('');

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
async function initFilters() {
    const container = document.getElementById('partnerFilter');
    if (!container) return;

    // 先从后端拉取标签列表（仅 activity 类别，排除 food / identity / 价格标签）
    try {
        const result = await listTags();
        allTags = (result.items || []).filter(t => {
            // 排除价格/数字标签
            if (/^[\d¥￥]/.test(t.name) || ['AA', '免费', '自费'].includes(t.name)) return false;
            // 排除 food 和 identity 类别
            if (t.category === 'food' || t.category === 'identity') return false;
            // 保留 activity 类别 + 搭子类型（category 可能为 unknown）
            return true;
        });
    } catch (e) {
        allTags = [];
    }

    const chips = [
        { label: '全部', category: 'all' },
        ...allTags.slice(0, 10).map(t => ({ label: t.name, category: t.name })),
    ];

    container.innerHTML = chips.map((c, i) =>
        `<span class="filter-chip${i === 0 ? ' active' : ''}" data-category="${escapeHtml(c.category)}">${escapeHtml(c.label)}</span>`
    ).join('');

    container.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', async () => {
            currentCategory = chip.getAttribute('data-category');
            container.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            await loadPostsFromAPI();
            renderWaterfall();
            refreshPreviewMarkers();
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

    // 时长类型 + 时间模式联动
    let currentDuration = 'short';   // 'short' | 'long'
    let currentUrgency = 'now';     // 'now' | 'scheduled'
    const scheduledRow = document.getElementById('scheduledTimeRow');
    const timeModeRow = document.getElementById('timeModeRow');

    // 长期/短期切换
    const durationBtns = document.querySelectorAll('#durationRow .time-mode-btn');
    durationBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            durationBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentDuration = btn.getAttribute('data-duration');
            // 长期 → 隐藏时间行；短期 → 显示时间行
            timeModeRow.style.display = currentDuration === 'long' ? 'none' : 'flex';
            scheduledRow.style.display = 'none';  // 切换时长时重置指定时间行
        });
    });

    // 短期时间模式切换（立即 / 指定）
    const timeModeBtns = modal.querySelectorAll('#timeModeRow .time-mode-btn');
    timeModeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            timeModeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentUrgency = btn.getAttribute('data-mode');
            scheduledRow.style.display = currentUrgency === 'scheduled' ? 'flex' : 'none';
        });
    });

    // ── 地点搜索自动补全（后端代理高德 inputtips）──
    let selectedLocationCoords = null;  // "lng,lat" 字符串
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
        selectedLocationCoords = null;
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
            selectedLocationCoords = loc;
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
        currentDuration = 'short';
        durationBtns.forEach(b => b.classList.remove('active'));
        const defaultDurationBtn = document.querySelector('#durationRow .time-mode-btn[data-duration="short"]');
        if (defaultDurationBtn) defaultDurationBtn.classList.add('active');
        if (timeModeRow) timeModeRow.style.display = 'flex';
        // 重置时间模式为立即
        timeModeBtns.forEach(b => b.classList.remove('active'));
        const defaultTimeBtn = modal.querySelector('#timeModeRow .time-mode-btn[data-mode="now"]');
        if (defaultTimeBtn) defaultTimeBtn.classList.add('active');
        currentUrgency = 'now';
        if (scheduledRow) scheduledRow.style.display = 'none';
        // 重置地点搜索状态
        selectedLocationCoords = null;
        suggestionIndex = -1;
        if (suggestionsBox) suggestionsBox.style.display = 'none';
        modal.style.display = 'flex';
    };

    const closeModal = () => {
        modal.style.display = 'none';
        form?.reset();
        selectedLocationCoords = null;
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
        const editId = modal.getAttribute('data-edit-id');

        if (!category || !title) {
            showToast('请至少填写分类和标题');
            return;
        }

        let event_time = null;
        if (currentUrgency === 'scheduled') {
            const dateVal = document.getElementById('partnerDate')?.value;
            const timeVal = document.getElementById('partnerTimePicker')?.value;
            if (!dateVal || !timeVal) {
                showToast('请选择具体的日期和时间');
                return;
            }
            event_time = new Date(`${dateVal}T${timeVal}:00`).toISOString();
        }

        const tags = [category];
        if (budget) tags.push(budget);

        const btnText = editId ? '更新中...' : '发布中...';
        submitBtn.disabled = true;
        submitBtn.innerText = btnText;

        try {
            if (editId) {
                const { updatePost } = await import('../api.js');
                await updatePost(parseInt(editId), {
                    type: currentDuration === 'long' ? 'forum' : 'event',
                    title, content: description || title, tags,
                    location: selectedLocationCoords || null,
                    location_name: location || null,
                    urgency: currentUrgency,
                    event_time,
                });
                modal.removeAttribute('data-edit-id');
                showToast('组局已更新');
            } else {
                await createPost({
                    type: currentDuration === 'long' ? 'forum' : 'event',
                    title, content: description || title, tags,
                    location: selectedLocationCoords || null,
                    location_name: location || null,
                    urgency: currentUrgency,
                    event_time,
                });
                showToast('发布成功');
            }
            closeModal();
            partnersData = await loadPostsFromAPI();
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
export async function initPartnerPage() {
    // 纯事件绑定，不依赖任何数据，立即执行
    initPartnerModal();
    initPostDetailModal();

    // 桌面端：使用 grid 布局（filter + waterfall 在右侧面板中，配合 display: contents）
    _ensureRightPanel();

    // 数据加载 + 筛选栏初始化 → 并行发起
    const dataPromise = partnersData.length ? Promise.resolve(partnersData) : loadPostsFromAPI();
    const filtersPromise = initFilters();

    // 瀑布流渲染：等数据回来就立刻画（不等筛选栏）
    const posts = await dataPromise;
    renderWaterfall();

    // 筛选栏独立完成
    await filtersPromise;

    // 地图延迟初始化：等数据 + AMap SDK 都就绪
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
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

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
