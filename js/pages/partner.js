import { showToast } from '../utils.js';
import { isLoggedIn, getUser } from '../auth.js';

// 全局搭子数据存储
let partnersData = [];

// 当前选中分类
let currentCategory = 'all';

// 消息回调 (用于更新右侧消息中心)
let addSystemMessageCallback = null;

/**
 * 初始化示例数据
 */
function initSampleData() {
    const now = new Date();
    const timeStr = (offset) => {
        const d = new Date(now);
        d.setDate(d.getDate() - offset);
        return d.toLocaleString();
    };

    return [
        {
            id: '1',
            category: '饭搭子',
            title: '一起去南苑吃火锅',
            description: '今晚18:00出发，缺2人，AA制，南苑食堂三楼重庆老火锅。',
            publisher: '张同学',
            contact: 'zhang123@nju.edu.cn',
            createdAt: timeStr(0),
        },
        {
            id: '2',
            category: '学习搭子',
            title: '高数期末冲刺',
            description: '图书馆自习，每天19:00-22:00，互相监督答疑，仅限仙林校区。',
            publisher: '李同学',
            contact: 'lixiao@nju.edu.cn',
            createdAt: timeStr(1),
        },
        {
            id: '3',
            category: '运动搭子',
            title: '夜跑5公里',
            description: '操场集合，每晚20:30，配速6分左右，一起运动打卡。',
            publisher: '王同学',
            contact: 'wangrun@nju.edu.cn',
            createdAt: timeStr(2),
        },
        {
            id: '4',
            category: '游戏搭子',
            title: '王者荣耀开黑',
            description: '周末五排，缺中路和辅助，段位星耀以上，心态好不喷人。',
            publisher: '陈同学',
            contact: 'chenchen@nju.edu.cn',
            createdAt: timeStr(3),
        },
        {
            id: '5',
            category: '电影搭子',
            title: '周末看《好东西》',
            description: '周六下午新街口德基影城，喜欢剧情片的一起，看完可以讨论。',
            publisher: '周同学',
            contact: 'zhoumo@nju.edu.cn',
            createdAt: timeStr(4),
        },
    ];
}

/**
 * 渲染搭子卡片
 */
function renderPartnerCards() {
    const container = document.getElementById('partnerGrid');
    if (!container) return;

    const filtered = currentCategory === 'all'
        ? partnersData
        : partnersData.filter(p => p.category === currentCategory);

    if (filtered.length === 0) {
        container.innerHTML = `<div class="page-placeholder" style="grid-column:1/-1;"><p>暂无搭子信息，快来发布第一个吧~</p></div>`;
        return;
    }

    container.innerHTML = filtered.map(partner => `
        <div class="partner-card" data-id="${partner.id}">
            <div class="partner-card-content">
                <div class="partner-card-header">
                    <span class="partner-category">${partner.category}</span>
                    <span class="partner-time">${partner.createdAt}</span>
                </div>
                <div class="partner-card-title">${escapeHtml(partner.title)}</div>
                <div class="partner-card-desc">${escapeHtml(partner.description)}</div>
                <div class="partner-card-meta">
                    <span class="partner-publisher"><i class="fas fa-user-circle"></i> ${escapeHtml(partner.publisher)}</span>
                    <button class="contact-btn" data-contact="${escapeHtml(partner.contact)}">联系TA</button>
                </div>
            </div>
        </div>
    `).join('');

    // 绑定联系按钮事件
    document.querySelectorAll('.contact-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const contact = btn.getAttribute('data-contact');
            showToast(`联系方式: ${contact}`, 3000);
        });
    });
}

/**
 * 添加一条新的搭子
 */
function addPartner(partnerData) {
    const newPartner = {
        id: Date.now().toString(),
        ...partnerData,
        createdAt: new Date().toLocaleString(),
    };
    partnersData.unshift(newPartner); // 最新在上方
    renderPartnerCards();

    // 发布成功提示
    showToast('搭子信息发布成功！', 2500);

    // 调用消息中心回调，增加系统通知
    if (addSystemMessageCallback) {
        addSystemMessageCallback(`你的搭子“${partnerData.title}”已成功发布，快去看看吧~`);
    }

    // 如果当前分类不是“全部”且新发布的分类与当前过滤不一致，提示用户切换查看
    if (currentCategory !== 'all' && currentCategory !== partnerData.category) {
        showToast(`发布成功！当前筛选为“${currentCategory}”，可切换到“全部”查看新内容`, 3000);
    }
}

/**
 * 初始化分类筛选事件
 */
function initFilters() {
    const filterContainer = document.getElementById('partnerFilter');
    if (!filterContainer) return;

    filterContainer.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const category = chip.getAttribute('data-category');
            currentCategory = category;

            // 高亮样式
            filterContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');

            renderPartnerCards();
        });
    });
}

/**
 * 发布搭子模态框逻辑
 */
function initPartnerModal() {
    const modal = document.getElementById('partnerModal');
    const openBtn = document.getElementById('openPartnerModalBtn');
    const closeBtn = document.getElementById('closePartnerModalBtn');
    const cancelBtn = document.getElementById('cancelPartnerBtn');
    const submitBtn = document.getElementById('submitPartnerBtn');
    const form = document.getElementById('partnerForm');

    if (!modal) return;

    const openModal = () => {
        // 检查登录状态
        if (!isLoggedIn()) {
            showToast('请先登录后再发布搭子信息');
            const authModal = document.getElementById('authModal');
            if (authModal) authModal.style.display = 'flex';
            return;
        }
        modal.style.display = 'flex';
    };

    const closeModal = () => {
        modal.style.display = 'none';
        form.reset();
    };

    openBtn?.addEventListener('click', openModal);
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    submitBtn?.addEventListener('click', () => {
        const category = document.getElementById('partnerCategory').value;
        const title = document.getElementById('partnerTitle').value.trim();
        const description = document.getElementById('partnerDesc').value.trim();
        const contact = document.getElementById('partnerContact').value.trim();

        if (!category || !title || !description || !contact) {
            showToast('请填写所有字段');
            return;
        }

        const user = getUser();
        const publisher = user?.username || (user?.email?.split('@')[0]) || '匿名同学';

        addPartner({
            category,
            title,
            description,
            contact,
            publisher,
        });

        closeModal();
    });
}

/**
 * 初始化右侧消息中心动态渲染 (支持系统消息)
 */
function initMessagePanel() {
    const panelBody = document.getElementById('messagePanelBody');
    if (!panelBody) return;

    // 消息存储
    let messages = [];

    // 渲染消息列表
    const renderMessages = () => {
        if (!panelBody) return;
        if (messages.length === 0) {
            panelBody.innerHTML = `<div class="message-empty"><i class="fas fa-inbox"></i><p>暂无新消息</p></div>`;
            return;
        }
        panelBody.innerHTML = messages.map(msg => `
            <div class="message-item">
                <div class="message-dot"></div>
                <div class="message-content">
                    <div class="message-title">${escapeHtml(msg.title)}</div>
                    <div class="message-time">${msg.time}</div>
                </div>
            </div>
        `).join('');
    };

    // 添加系统消息的公开方法
    const addMessage = (content) => {
        messages.unshift({
            title: content,
            time: new Date().toLocaleString(),
        });
        renderMessages();
        // 可在此添加小红点提示（可选）
    };

    // 示例启动消息（可选，为了演示右侧不为空，可注释）
    // addMessage('欢迎使用南大图谱！');

    // 将回调暴露给 partner 模块使用
    addSystemMessageCallback = addMessage;
}

/**
 * 页面主入口: 初始化整个找搭子模块
 */
export function initPartnerPage() {
    // 如果已经加载过数据，则不再重复初始化示例，避免覆盖用户发布的新数据
    if (!partnersData.length) {
        partnersData = initSampleData();
    }
    initPartnerModal();
    initFilters();
    renderPartnerCards();
    initMessagePanel();
}

// 辅助函数
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}