import { initPartnerPage } from './pages/partner.js';
import { initGuidePage } from './pages/guide.js';
import { isLoggedIn, getUser, doLogout } from './auth.js';
import { showToast } from './utils.js';
import { chatRecommend } from './api.js';
import { initProfilePage, refreshProfile } from './pages/profile.js';
import { showHomePage } from './pages/home.js';
import { loadAmapScript } from './config.js';

let currentPage = 'partner';
let aiSessionId = null;
const pageTitles = {
    partner: '找搭子',
    guide: '指南',
    profile: '我的',
    fullMap: '组局地图',
};

function switchPage(pageId) {
    // 「我的」页面需要登录
    if (pageId === 'profile' && !isLoggedIn()) {
        const modal = document.getElementById('authModal');
        if (modal) modal.style.display = 'flex';
        return;
    }

    // 隐藏所有页面
    document.querySelectorAll('.content-area .page').forEach(page => {
        page.classList.remove('active-page');
    });

    // 显示目标页面
    const pageMap = {
        partner: 'partnerPage',
        guide: 'guidePage',
        profile: 'profilePage',
        fullMap: 'fullMapPage',
    };

    const targetId = pageMap[pageId];
    if (targetId) {
        const target = document.getElementById(targetId);
        if (target) target.classList.add('active-page');
    }

    const titleEl = document.getElementById('pageTitle');
    if (titleEl && pageTitles[pageId]) titleEl.innerText = pageTitles[pageId];

    currentPage = pageId;

    // 更新底部 Tab 高亮
    document.querySelectorAll('.bottom-tab-bar .tab-item').forEach(item => {
        const tabPage = item.getAttribute('data-page');
        item.classList.toggle('active', tabPage === pageId);
    });

    // 页面切换时的初始化
    if (pageId === 'guide') initGuidePage();
    else if (pageId === 'profile') refreshProfile();
    else if (pageId === 'fullMap') {
        // 全屏地图：等浏览器完成布局后再初始化，避免容器尺寸为 0
        requestAnimationFrame(() => {
            requestAnimationFrame(() => initFullMapMarkers());
        });
    }

    // 地图页和全屏地图页不显示悬浮元素
    const fab = document.getElementById('fabCreateGroup');
    const aiBall = document.getElementById('aiFloatBall');
    if (fab && aiBall) {
        if (pageId === 'fullMap') {
            fab.style.display = 'none';
            aiBall.style.display = 'none';
        } else {
            fab.style.display = 'flex';
            aiBall.style.display = 'flex';
        }
    }
}

// 全屏地图标记初始化（委托给 partner 模块的高德地图实例）
async function initFullMapMarkers() {
    if (typeof window.initFullMapMarkers === 'function') {
        try {
            await window.initFullMapMarkers();
        } catch (err) {
            console.warn('全屏地图初始化失败:', err);
        }
    }
}

function updateNavBar() {
    const guestNav = document.getElementById('navGuestTop');
    const userNav = document.getElementById('navUserTop');
    const usernameSpan = document.getElementById('usernameSpan');

    if (isLoggedIn()) {
        if (guestNav) guestNav.style.display = 'none';
        if (userNav) userNav.style.display = 'flex';
        document.body.classList.add('logged-in');

        const user = getUser();
        if (usernameSpan && user) {
            usernameSpan.innerText = user.username || (user.email ? user.email.split('@')[0] : '同学');
            usernameSpan.onclick = () => switchPage('profile');
        }
    } else {
        if (guestNav) guestNav.style.display = 'flex';
        if (userNav) userNav.style.display = 'flex';
        document.body.classList.remove('logged-in');
    }

    // 默认显示找搭子
    if (!currentPage || currentPage === 'fullMap') {
        switchPage('partner');
    }
}

// ========== AI 浮层逻辑 ==========
function initAIFloat() {
    const aiBall = document.getElementById('aiFloatBall');
    const aiOverlay = document.getElementById('aiChatOverlay');
    const aiClose = document.getElementById('aiChatClose');
    const aiEntryBtn = document.getElementById('aiEntryBtn');
    const aiSendBtn = document.getElementById('aiChatSendBtn');
    const aiInput = document.getElementById('aiChatInput');
    const aiMessages = document.getElementById('aiChatMessages');
    const aiQuickBtns = document.getElementById('aiQuickBtns');

    const openAI = () => {
        if (aiOverlay) aiOverlay.classList.add('open');
        if (aiBall) aiBall.style.display = 'none';
    };

    const closeAI = () => {
        if (aiOverlay) aiOverlay.classList.remove('open');
        if (aiBall) aiBall.style.display = 'flex';
    };

    aiBall?.addEventListener('click', openAI);
    aiEntryBtn?.addEventListener('click', openAI);
    aiClose?.addEventListener('click', closeAI);

    // 点击遮罩外部关闭（在浮层内部点空白处）
    aiOverlay?.addEventListener('click', (e) => {
        if (e.target === aiOverlay) closeAI();
    });



    // 发送消息
    const sendMessage = async () => {
        const text = aiInput?.value.trim();
        if (!text) return;

        // 添加用户消息
        const userMsg = document.createElement('div');
        userMsg.className = 'chat-message chat-user';
        userMsg.textContent = text;
        aiMessages?.appendChild(userMsg);

        if (aiInput) aiInput.value = '';
        aiMessages.scrollTop = aiMessages.scrollHeight;

        // 显示打字中
        const typingMsg = document.createElement('div');
        typingMsg.className = 'chat-message chat-bot typing';
        typingMsg.innerHTML = '<i class="fas fa-robot"></i> 思考中...';
        aiMessages?.appendChild(typingMsg);
        aiMessages.scrollTop = aiMessages.scrollHeight;

        try {
            const response = await chatRecommend(text, aiSessionId, '南京');
            // 移除打字提示
            typingMsg.remove();

            if (response.session_id) aiSessionId = response.session_id;

            const botMsg = document.createElement('div');
            botMsg.className = 'chat-message chat-bot';
            botMsg.innerHTML = `<i class="fas fa-robot"></i> ${escapeHtmlAI(response.reply || '抱歉，我暂时无法回答这个问题，请稍后再试～')}`;
            aiMessages?.appendChild(botMsg);
        } catch (err) {
            typingMsg.remove();
            const errMsg = document.createElement('div');
            errMsg.className = 'chat-message chat-bot';
            errMsg.innerHTML = '<i class="fas fa-robot"></i> 网络出小差了，请稍后再试～';
            aiMessages?.appendChild(errMsg);
        }
        aiMessages.scrollTop = aiMessages.scrollHeight;
    };

    aiSendBtn?.addEventListener('click', sendMessage);
    aiInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    // 快捷提问按钮
    aiQuickBtns?.querySelectorAll('.ai-quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (aiInput) {
                aiInput.value = btn.textContent;
                sendMessage();
            }
        });
    });
}

function escapeHtmlAI(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]);
}
// ========== 全屏地图返回 ==========
function initFullMapPage() {
    const backBtn = document.getElementById('backFromMapBtn');
    backBtn?.addEventListener('click', () => {
        switchPage('partner');
    });
}

// ========== 底部 Tab ==========
function initBottomTabs() {
    document.querySelectorAll('.bottom-tab-bar .tab-item').forEach(tab => {
        tab.addEventListener('click', () => {
            const page = tab.getAttribute('data-page');
            if (page) switchPage(page);
        });
    });
}

// ========== FAB 按钮 ==========
function initFabButton() {
    const fab = document.getElementById('fabCreateGroup');
    fab?.addEventListener('click', () => {
        // 与发布搭子按钮相同逻辑
        if (!isLoggedIn()) {
            showToast('请先登录后再发起组局');
            const authModal = document.getElementById('authModal');
            if (authModal) authModal.style.display = 'flex';
            return;
        }
        const modal = document.getElementById('partnerModal');
        if (modal) modal.style.display = 'flex';
    });
}

// ========== 地图展开按钮 ==========
function initMapExpand() {
    const expandBtn = document.getElementById('mapExpandBtn');
    expandBtn?.addEventListener('click', () => {
        switchPage('fullMap');
    });
}

// ========== 初始化 ==========
function init() {
    updateNavBar();
    loadAmapScript().catch(err => console.warn('AMap load failed:', err));

    // 初始化各模块
    showHomePage();          // 绑定登录/注册/找回密码等按钮事件
    initBottomTabs();
    initAIFloat();
    initFabButton();
    initMapExpand();
    initFullMapPage();

    // 默认加载找搭子页面
    switchPage('partner');
    initPartnerPage();
}

// 全局事件
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await doLogout();
    updateNavBar();
    switchPage('partner');
    showToast('已退出登录');
});

document.getElementById('closeAuthModalBtn')?.addEventListener('click', () => {
    document.getElementById('authModal').style.display = 'none';
});

document.getElementById('authModal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        document.getElementById('authModal').style.display = 'none';
    }
});

// 暴露给全局
window.switchPage = switchPage;
window.updateNavBar = updateNavBar;

init();
