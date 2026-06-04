import { showToast, formatDate, wgs84ToGcj02 } from '../utils.js';
import { isLoggedIn, getUser } from '../auth.js';
import { listPosts, createPost, participateEvent, listTags } from '../api.js';

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
    if (!cat) return { color: '#999', icon: '📍', tagClass: 'tag-default' };
    if (!categoryColorCache[cat]) {
        const hue = [...cat].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
        categoryColorCache[cat] = {
            color: `hsl(${hue}, 65%, 50%)`,
            icon: '📍',
            tagClass: 'tag-dynamic',
        };
    }
    return categoryColorCache[cat];
}

// ============================================================
// 数据加载：从后端 API 获取帖子列表
// ============================================================
async function loadPostsFromAPI() {
    try {
        const params = { sort: 'hot', page_size: 50 };
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
    // urgency='now' → 显示"⚡ 立即"
    if (urgency === 'now') return '⚡ 立即';
    // urgency='long_term' → 显示"📅 长期有效"
    if (urgency === 'long_term') return '📅 长期有效';
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

    // 默认中心：仙林大学城
    const center = wgs84ToGcj02(118.945, 32.112);

    return new window.AMap.Map(containerId, {
        zoom: 14,
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
                    ${post.time ? `<div>⏰ ${escapeHtml(post.time)}</div>` : ''}
                    <button id="map-join-${post.id}" style="margin-top:8px;padding:6px 14px;background:linear-gradient(135deg,#5B2E8C,#EC4899);color:white;border:none;border-radius:14px;cursor:pointer;font-size:0.8rem;">👋 我要参加</button>
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

    container.innerHTML = filtered.map(p => {
        const style = _categoryStyle(p.category);
        return `
        <div class="partner-card" data-id="${p.id}">
            <div class="partner-card-content">
                <div class="partner-card-tags">
                    ${p.tags.map(t => `<span class="partner-card-tag">📍 ${escapeHtml(t)}</span>`).join('')}
                </div>
                <div class="partner-card-title">${escapeHtml(p.title)}</div>
                <div class="partner-card-desc">${escapeHtml(p.description).substring(0, 100)}</div>
                <div class="partner-card-meta">
                    ${p.location ? `<span><i class="fas fa-map-pin"></i> ${escapeHtml(p.location)}</span>` : ''}
                    ${p.time ? `<span><i class="fas fa-clock"></i> ${escapeHtml(p.time)}</span>` : ''}
                    <span><i class="fas fa-user"></i> ${p.publisher}</span>
                </div>
                <div class="partner-card-stats">
                    <span>❤️ ${p.likeCount}</span>
                    <span>💬 ${p.commentCount}</span>
                    <span>👥 ${p.members}人参加</span>
                </div>
                <button class="join-btn" data-id="${p.id}">
                    ${p.type === 'event' ? '✅ 我要参加' : '👋 我也感兴趣'}
                </button>
            </div>
        </div>`;
    }).join('');

    // 「参加」按钮
    container.querySelectorAll('.join-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleParticipate(parseInt(btn.getAttribute('data-id')));
        });
    });

    // 卡片点击 → 发 Toast 预览（后续可改为跳详情页）
    container.querySelectorAll('.partner-card').forEach(card => {
        card.addEventListener('click', () => {
            const pid = parseInt(card.getAttribute('data-id'));
            const post = partnersData.find(p => p.id === pid);
            if (post) {
                showToast(`「${post.title}」— ${post.publisher} 发布 · ${post.likeCount}赞 ${post.commentCount}评`, 3000);
            }
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
            showToast('报名成功！🎉');
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

// ============================================================
// 分类筛选（动态生成，基于后端标签）
// ============================================================
async function initFilters() {
    const container = document.getElementById('partnerFilter');
    if (!container) return;

    // 先从后端拉取标签列表
    try {
        const result = await listTags();
        allTags = result.items || [];
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

    // 时间模式切换
    let currentUrgency = 'now';
    const scheduledRow = document.getElementById('scheduledTimeRow');
    const timeModeBtns = modal.querySelectorAll('.time-mode-btn');
    timeModeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            timeModeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentUrgency = btn.getAttribute('data-mode');
            scheduledRow.style.display = currentUrgency === 'scheduled' ? 'flex' : 'none';
        });
    });

    const openModal = () => {
        if (!isLoggedIn()) {
            showToast('请先登录后再发起组局');
            const authModal = document.getElementById('authModal');
            if (authModal) authModal.style.display = 'flex';
            return;
        }
        // 重置时间模式为默认（立即）
        timeModeBtns.forEach(b => b.classList.remove('active'));
        const defaultBtn = modal.querySelector('.time-mode-btn[data-mode="now"]');
        if (defaultBtn) defaultBtn.classList.add('active');
        currentUrgency = 'now';
        if (scheduledRow) scheduledRow.style.display = 'none';
        modal.style.display = 'flex';
    };

    const closeModal = () => {
        modal.style.display = 'none';
        form?.reset();
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

        if (!category || !title) {
            showToast('请至少填写分类和标题');
            return;
        }

        // 构建时间相关字段
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

        // 构建标签
        const tags = [category];
        if (budget) tags.push(budget);

        submitBtn.disabled = true;
        submitBtn.innerText = '发布中...';

        try {
            await createPost({
                type: category.includes('运动') || category.includes('活动') ? 'event' : 'forum',
                title: title,
                content: description || title,
                tags: tags,
                location: null,
                location_name: location || null,
                urgency: currentUrgency,
                event_time: event_time,
            });

            showToast('发布成功！🎉');
            closeModal();
            // 刷新列表
            await loadPostsFromAPI();
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
    // 首次加载从 API 获取真实数据
    if (!partnersData.length) {
        await loadPostsFromAPI();
    }
    initPartnerModal();
    await initFilters();
    renderWaterfall();
    initPreviewMap();
}

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
