import { initPartnerPage } from './pages/partner.js';
import { initGuidePage } from './pages/guide.js';
import { isLoggedIn, getUser, doLogout } from './auth.js';
import { showToast } from './utils.js';
import { initProfilePage, refreshProfile } from './pages/profile.js';
import { showHomePage } from './pages/home.js';
import { loadAmapScript } from './config.js';
import { initAIPage } from './pages/ai.js';

// 延迟导入 openPostDetail，避免循环依赖
let openPostDetailFn = null;
async function getOpenPostDetail() {
    if (!openPostDetailFn) {
        const mod = await import('./pages/partner.js');
        openPostDetailFn = mod.openPostDetail;
    }
    return openPostDetailFn;
}
// 暴露给 profile 等模块使用
window.openPostDetail = async (postId) => {
    const fn = await getOpenPostDetail();
    fn(postId);
};

let currentPage = 'home';
const pageTitles = {
    home: '首页',
    partner: '找搭子',
    ai: 'AI助手',
    guide: '吃喝玩乐',
    profile: '个人',
    fullMap: '组局地图',
};

function switchPage(pageId) {
    // 这些页面沿用现有登录模态框；这里不改账号流程，只把入口统一接到已有 authModal。
    const protectedPages = ['profile'];
    if (protectedPages.includes(pageId) && !isLoggedIn()) {
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
        home: 'homePage',
        partner: 'partnerPage',
        ai: 'aiPage',
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
    // 桌面导航和底部导航共用同一个 active 状态，避免两个导航看起来不同步。
    document.querySelectorAll('.desktop-nav .desktop-nav-item').forEach(item => {
        const tabPage = item.getAttribute('data-page');
        item.classList.toggle('active', tabPage === pageId);
    });

    // 页面切换时的初始化
    if (pageId === 'guide') initGuidePage();
    else if (pageId === 'ai') initAIPage();
    else if (pageId === 'profile') refreshProfile();
    else if (pageId === 'fullMap') {
        // 全屏地图：等浏览器完成布局后再初始化，避免容器尺寸为 0
        requestAnimationFrame(() => {
            requestAnimationFrame(() => initFullMapMarkers());
        });
    }

    // 发起组局按钮只属于找搭子页，离开该页时隐藏。
    const fab = document.getElementById('fabCreateGroup');
    if (fab) {
        fab.style.display = pageId === 'partner' ? 'flex' : 'none';
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
        if (userNav) userNav.style.display = 'none';
        document.body.classList.remove('logged-in');
    }

    // 默认回到首页，避免未登录用户直接落到需要账号的功能页。
    if (!currentPage || currentPage === 'fullMap') {
        switchPage('home');
    }
}

function initFullMapPage() {
    const backBtn = document.getElementById('backFromMapBtn');
    backBtn?.addEventListener('click', () => {
        switchPage('partner');
    });
}

// ========== 页面导航 ==========
function initNavigation() {
    // 所有带 data-page 的视觉入口走同一套切页函数，像把多扇门接到同一个走廊。
    document.querySelectorAll('[data-page]').forEach(tab => {
        tab.addEventListener('click', () => {
            const page = tab.getAttribute('data-page');
            if (page) switchPage(page);
        });
    });
}

// ========== 主题切换 ==========
function initThemeToggle() {
    const themeButton = document.getElementById('themeToggleBtn');
    const savedTheme = localStorage.getItem('njuatlas-theme') || 'light';

    // localStorage 就像浏览器里的小笔记本，可以记住上次离开时是开灯还是关灯。
    const applyTheme = (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        if (themeButton) themeButton.textContent = theme === 'dark' ? '☀️' : '🌙';
        localStorage.setItem('njuatlas-theme', theme);
    };

    applyTheme(savedTheme);

    themeButton?.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });
}

// ========== 首页像素方块 ==========
function initPixelField() {
    const field = document.getElementById('pixelField');
    if (!field || field.dataset.ready === 'true') return;

    // CSS Grid 就像在纸上画格子，这里用 64 个格子围住 NJUATLAS 标识。
    const cellCount = 64;
    for (let i = 0; i < cellCount; i += 1) {
        const cell = document.createElement('span');
        cell.className = 'pixel-cell';
        cell.style.setProperty('--i', i);
        cell.style.setProperty('--row', Math.floor(i / 8));
        cell.style.setProperty('--col', i % 8);
        cell.style.setProperty('--delay', `${(i % 10) * 0.08}s`);
        field.appendChild(cell);
    }
    field.dataset.ready = 'true';
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
    initNavigation();
    initThemeToggle();
    initPixelField();
    initFabButton();
    initMapExpand();
    initFullMapPage();
    initProfilePage();       // 绑定个人中心编辑资料等按钮事件

    // 默认加载首页，同时预加载找搭子数据，用户登录后进入页面不需要再等首屏初始化。
    switchPage('home');
    initPartnerPage();
}

// 全局事件
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await doLogout();
    updateNavBar();
    switchPage('home');
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
