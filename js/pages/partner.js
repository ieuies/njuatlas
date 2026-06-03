import { showToast } from '../utils.js';
import { isLoggedIn, getUser } from '../auth.js';

// ============================================================
// 全局状态
// ============================================================
let partnersData = [];
let currentCategory = 'all';

// 高德地图实例（预览 & 全屏）
let previewMap = null;
let fullMapInstance = null;
let previewMarkers = [];

// 分类 -> 颜色 / 图标映射
const categoryColors = {
    '饭搭子': { tag: 'tag-fandazi', color: '#F59E0B', icon: '🍜' },
    '运动搭子': { tag: 'tag-yundong', color: '#10B981', icon: '🏃' },
    '学习搭子': { tag: 'tag-xuexi', color: '#3B82F6', icon: '📚' },
    '游戏搭子': { tag: 'tag-youxi', color: '#7C3AED', icon: '🎮' },
    '电影搭子': { tag: 'tag-dianying', color: '#EC4899', icon: '🎬' },
};

// 南大附近各类型组局的模拟经纬度（用于地图标记）
const locationCoords = [
    { name: '仙林金鹰', lnglat: [118.938, 32.106] },
    { name: '南大仙林体育馆', lnglat: [118.944, 32.113] },
    { name: '线上', lnglat: [118.92, 32.09] },
    { name: '新街口德基', lnglat: [118.784, 32.044] },
    { name: '南大杜厦图书馆', lnglat: [118.948, 32.118] },
    { name: '南苑食堂三楼', lnglat: [118.942, 32.108] },
];

// ============================================================
// 示例数据
// ============================================================
function initSampleData() {
    const now = new Date();
    const timeStr = (offset) => {
        const d = new Date(now);
        d.setDate(d.getDate() - offset);
        return `${d.getMonth() + 1}/${d.getDate()}`;
    };

    return [
        {
            id: '1',
            category: '饭搭子',
            title: '周五晚仙林剧本杀 缺1人',
            description: '推理本《雾鸦馆》，新手友好，AA制，金鹰旁边那家店',
            location: '仙林金鹰',
            time: '周五 19:00',
            budget: 'AA/80元',
            slots: 1,
            publisher: '张同学',
            contact: 'zhang123@nju.edu.cn',
            members: 4,
            createdAt: timeStr(0),
            nearby: '附近推荐：海底捞火锅 · 步行5分钟',
        },
        {
            id: '2',
            category: '运动搭子',
            title: '周六下午羽毛球 二缺二',
            description: '仙林体育馆3号场，自带球拍，中等水平即可',
            location: '南大仙林体育馆',
            time: '周六 14:00',
            budget: '场地AA/20元',
            slots: 2,
            publisher: '李同学',
            contact: 'lixiao@nju.edu.cn',
            members: 2,
            createdAt: timeStr(1),
            nearby: '附近推荐：南大游泳馆 · 步行3分钟',
        },
        {
            id: '3',
            category: '游戏搭子',
            title: '王者荣耀开黑 缺中路',
            description: '周末五排，缺中路和辅助，段位星耀以上，心态好不喷人',
            location: '线上',
            time: '周末晚上',
            budget: '免费',
            slots: 2,
            publisher: '陈同学',
            contact: 'chenchen@nju.edu.cn',
            members: 3,
            createdAt: timeStr(2),
            nearby: '',
        },
        {
            id: '4',
            category: '电影搭子',
            title: '周六新街口看《好东西》',
            description: '德基影城下午场，喜欢剧情片的一起，看完可以讨论',
            location: '新街口德基',
            time: '周六 15:00',
            budget: 'AA/60元',
            slots: 2,
            publisher: '周同学',
            contact: 'zhoumo@nju.edu.cn',
            members: 2,
            createdAt: timeStr(3),
            nearby: '附近推荐：新街口美食街 · 步行2分钟',
        },
        {
            id: '5',
            category: '学习搭子',
            title: '高数期末冲刺自习',
            description: '图书馆自习，每天19:00-22:00，互相监督答疑，仅限仙林校区',
            location: '南大杜厦图书馆',
            time: '每天 19:00-22:00',
            budget: '免费',
            slots: 3,
            publisher: '王同学',
            contact: 'wangrun@nju.edu.cn',
            members: 3,
            createdAt: timeStr(4),
            nearby: '附近推荐：图书馆咖啡角',
        },
        {
            id: '6',
            category: '饭搭子',
            title: '南苑食堂火锅拼桌',
            description: '今晚18:00出发，重庆老火锅，AA制，人均不超过50',
            location: '南苑食堂三楼',
            time: '今晚 18:00',
            budget: 'AA/50元',
            slots: 2,
            publisher: '赵同学',
            contact: 'zhao@nju.edu.cn',
            members: 3,
            createdAt: timeStr(0),
            nearby: '附近推荐：南苑奶茶店 · 步行1分钟',
        },
    ];
}

// ============================================================
// 工具：根据 location 字符串近似获取经纬度
// ============================================================
function guessLngLat(location) {
    const found = locationCoords.find(c => c.name === location);
    if (found) return found.lnglat;
    // 默认回到南大仙林中心
    return [118.945, 32.112];
}

// ============================================================
// 高德地图初始化
// ============================================================
async function ensureAMap() {
    // 高德JSAPI已通过 <script> 全局引入，检查 window.AMap
    if (window.AMap) return window.AMap;
    // 等待最多5秒
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

/**
 * 创建地图实例
 * @param {string} containerId - DOM容器ID
 * @returns {Object} AMap instance
 */
function createMapInstance(containerId) {
    // 如果已经存在实例，销毁重建
    const container = document.getElementById(containerId);
    if (!container) return null;

    // 清空容器（防止残留）
    container.innerHTML = '';

    return new window.AMap.Map(containerId, {
        zoom: 14,
        center: [118.945, 32.112],  // 南大仙林
        mapStyle: 'amap://styles/light',
        resizeEnable: true,
    });
}

/**
 * 在地图上绘制标记
 * @param {Object} map - AMap实例
 * @param {Array} data - 组局数据
 * @returns {Array} markers
 */
function addMarkersToMap(map, data) {
    // 清除地图上旧标记
    map.clearMap();

    const markers = [];

    data.forEach(partner => {
        const [lng, lat] = guessLngLat(partner.location);
        const colors = categoryColors[partner.category] || { color: '#999', icon: '📍' };

        // 创建标记点
        const marker = new window.AMap.Marker({
            position: [lng, lat],
            title: partner.title,
            icon: new window.AMap.Icon({
                size: new window.AMap.Size(32, 32),
                image: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='12' fill='${encodeURIComponent(colors.color)}' stroke='white' stroke-width='3' /%3E%3C/svg%3E`,
                imageSize: new window.AMap.Size(32, 32),
            }),
            offset: new window.AMap.Pixel(-16, -16),
            zIndex: 100,
        });

        // 点击标记弹出信息窗体
        marker.on('click', () => {
            const infoContent = `
                <div class="amap-info-content" style="max-width:240px;font-size:0.85rem;">
                    <strong style="color:${colors.color};">${escapeHtml(partner.category)}</strong>
                    <div style="font-weight:700;margin:4px 0;">${escapeHtml(partner.title)}</div>
                    <div style="color:#666;">📍 ${escapeHtml(partner.location)}<br>⏰ ${escapeHtml(partner.time)}<br>💰 ${escapeHtml(partner.budget)}</div>
                    <button onclick="window.__mapContactClick('${escapeHtml(partner.contact)}')" style="margin-top:8px;padding:6px 14px;background:linear-gradient(135deg,#5B2E8C,#EC4899);color:white;border:none;border-radius:14px;cursor:pointer;font-size:0.8rem;">👋 联系TA</button>
                </div>
            `;

            const infoWindow = new window.AMap.InfoWindow({
                content: infoContent,
                offset: new window.AMap.Pixel(0, -36),
            });
            infoWindow.open(map, [lng, lat]);

            // 绑定全局联系按钮回调
            window.__mapContactClick = (contact) => {
                showToast(`联系方式: ${contact}`, 3000);
            };
        });

        marker.setMap(map);
        markers.push(marker);
    });

    return markers;
}

// ============================================================
// 预览地图
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
                : partnersData.filter(p => p.category === currentCategory);
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
        : partnersData.filter(p => p.category === currentCategory);
    addMarkersToMap(previewMap, filtered);
}

// ============================================================
// 全屏地图（供 app.js 调用）
// ============================================================
async function initFullMapMarkers() {
    try {
        await ensureAMap();
        const container = document.getElementById('fullMap');
        // 如果容器不可见或尺寸为0，等布局完成后再初始化
        if (!container || container.offsetWidth === 0) {
            await new Promise(r => setTimeout(r, 200));
        }
        if (!fullMapInstance) {
            fullMapInstance = createMapInstance('fullMap');
        }
        if (fullMapInstance) {
            addMarkersToMap(fullMapInstance, partnersData);
            // 触发地图重新计算大小（页面从 display:none 切回后需要）
            setTimeout(() => fullMapInstance?.resize(), 100);
        }
    } catch (err) {
        console.warn('全屏地图初始化失败:', err);
    }
}

// 暴露给全局
window.initFullMapMarkers = initFullMapMarkers;
window.partnersData = partnersData;
window.categoryColors = categoryColors;

// ============================================================
// 瀑布流卡片
// ============================================================
function renderWaterfall() {
    const container = document.getElementById('partnerWaterfall');
    if (!container) return;

    const filtered = currentCategory === 'all'
        ? partnersData
        : partnersData.filter(p => p.category === currentCategory);

    if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-tertiary);grid-column:1/-1;">暂无组局，快来发起第一个吧~</div>';
        return;
    }

    container.innerHTML = filtered.map(p => {
        const colors = categoryColors[p.category] || { tag: 'tag-fandazi', color: '#999', icon: '📍' };
        return `
        <div class="partner-card" data-id="${p.id}">
            <div class="partner-card-content">
                <span class="partner-card-tag ${colors.tag}">${colors.icon} ${p.category}</span>
                <div class="partner-card-title">${escapeHtml(p.title)}</div>
                <div class="partner-card-members">
                    <div class="member-avatars">
                        ${Array(Math.min(p.members, 4)).fill('').map((_, i) =>
                            `<div class="member-avatar" style="background:hsl(${280 + i * 40}, 50%, 80%);"><i class="fas fa-user"></i></div>`
                        ).join('')}
                    </div>
                    <span class="member-count">已有${p.members}人 · 缺${p.slots}人</span>
                </div>
                <div class="partner-card-meta">
                    ${p.location ? `<span><i class="fas fa-map-pin"></i> ${escapeHtml(p.location)}</span>` : ''}
                    ${p.time ? `<span><i class="fas fa-clock"></i> ${escapeHtml(p.time)}</span>` : ''}
                    ${p.budget ? `<span><i class="fas fa-yen-sign"></i> ${escapeHtml(p.budget)}</span>` : ''}
                </div>
                <button class="join-btn" data-id="${p.id}">👋 上车</button>
                ${p.nearby ? `<div class="card-nearby"><i class="fas fa-utensils"></i> ${escapeHtml(p.nearby)}</div>` : ''}
            </div>
        </div>`;
    }).join('');

    // 绑定「上车」按钮
    container.querySelectorAll('.join-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const pid = btn.getAttribute('data-id');
            const partner = partnersData.find(p => p.id === pid);
            if (partner) {
                showToast(`联系TA: ${partner.contact}`, 3000);
            }
        });
    });

    // 绑定卡片点击 → 显示联系人
    container.querySelectorAll('.partner-card').forEach(card => {
        card.addEventListener('click', () => {
            const pid = card.getAttribute('data-id');
            const partner = partnersData.find(p => p.id === pid);
            if (partner) {
                showToast(`「${partner.title}」— 联系方式: ${partner.contact}`, 3000);
            }
        });
    });
}

// ============================================================
// 分类筛选
// ============================================================
function initFilters() {
    const container = document.getElementById('partnerFilter');
    if (!container) return;

    container.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            currentCategory = chip.getAttribute('data-category');
            container.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
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

    const openModal = () => {
        if (!isLoggedIn()) {
            showToast('请先登录后再发起组局');
            const authModal = document.getElementById('authModal');
            if (authModal) authModal.style.display = 'flex';
            return;
        }
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

    submitBtn?.addEventListener('click', () => {
        const category = document.getElementById('partnerCategory')?.value;
        const title = document.getElementById('partnerTitle')?.value.trim();
        const description = document.getElementById('partnerDesc')?.value.trim();
        const location = document.getElementById('partnerLocation')?.value.trim();
        const time = document.getElementById('partnerTime')?.value.trim();
        const budget = document.getElementById('partnerBudget')?.value.trim();
        const slots = parseInt(document.getElementById('partnerSlots')?.value) || 1;
        const contact = document.getElementById('partnerContact')?.value.trim();

        if (!category || !title || !contact) {
            showToast('请填写分类、标题和联系方式');
            return;
        }

        const user = getUser();
        const publisher = user?.username || (user?.email?.split('@')[0]) || '匿名同学';

        const newPartner = {
            id: Date.now().toString(),
            category,
            title,
            description,
            location,
            time,
            budget,
            slots,
            publisher,
            contact,
            members: 1,
            createdAt: new Date().toLocaleString(),
            nearby: '',
        };

        partnersData.unshift(newPartner);
        renderWaterfall();
        refreshPreviewMarkers();
        closeModal();
        showToast('组局发布成功！🎉');
    });

    // 暴露给外部（FAB按钮）
    window.openPartnerModal = openModal;
}

// ============================================================
// 页面入口
// ============================================================
export function initPartnerPage() {
    if (!partnersData.length) {
        partnersData = initSampleData();
    }
    initPartnerModal();
    initFilters();
    renderWaterfall();
    // 异步初始化地图（不阻塞页面渲染）
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
