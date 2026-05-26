import { isLoggedIn, getUser, doLogout, resendVerificationEmail, updateUserFromLogin } from './auth.js';
import { showToast } from './utils.js';
import { showHomePage, hideHomePage } from './pages/home.js';
import { initRestaurantsPage, refreshRestaurants, initMapPage } from './pages/restaurants.js';
import { initAIPage } from './pages/ai.js';
import { initProfilePage, refreshProfile } from './pages/profile.js';

let currentPage = null;

// 页面标题映射
const pageTitles = {
    'restaurants': '餐厅',
    'map': '地图',
    'ai': 'AI助手',
    'scenic': '景点',
    'profile': '个人中心',
};

function switchPage(pageId) {
    // 隐藏所有页面（仅 content-area 内的 .page）
    document.querySelectorAll('.content-area .page').forEach(p => p.classList.remove('active-page'));
    const target = document.getElementById(`${pageId}Page`);
    if (target) {
        target.classList.add('active-page');
        // 更新顶栏标题
        const titleEl = document.getElementById('pageTitle');
        if (titleEl && pageTitles[pageId]) titleEl.innerText = pageTitles[pageId];
    }
    currentPage = pageId;

    // 高亮侧栏导航
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('data-page') === pageId) {
            item.classList.add('active');
        }
    });

    // 刷新对应页面数据
    if (pageId === 'restaurants') refreshRestaurants();
    else if (pageId === 'map') initMapPage();
    else if (pageId === 'profile') refreshProfile();
    else if (pageId === 'scenic') { /* 预留 */ }
    else if (pageId === 'ai') { /* AI 页面无需主动刷新 */ }

    // 关闭移动端侧栏
    closeSidebar();
}

function updateNavBar() {
    const guestNav = document.getElementById('navGuestTop');
    const userNav = document.getElementById('navUserTop');
    const usernameSpan = document.getElementById('usernameSpan');
    const homePage = document.getElementById('homePage');
    const pageTitle = document.getElementById('pageTitle');

    if (isLoggedIn()) {
        if (guestNav) guestNav.style.display = 'none';
        if (userNav) userNav.style.display = 'flex';
        document.body.classList.remove('logged-in');
        const user = getUser();
        if (user) usernameSpan.innerText = user.username || user.email.split('@')[0];
        // 隐藏首页，显示功能页
        if (homePage) homePage.classList.remove('active-page');
        if (pageTitle && pageTitles['restaurants']) pageTitle.innerText = pageTitles['restaurants'];
        // 默认跳转到餐厅页
        if (!currentPage) switchPage('restaurants');
    } else {
        if (guestNav) guestNav.style.display = 'flex';
        if (userNav) userNav.style.display = 'none';
        currentPage = null;
        // 显示首页
        if (homePage) homePage.classList.add('active-page');
        // 隐藏其他内容页
        document.querySelectorAll('.content-area .page').forEach(p => {
            if (p.id !== 'homePage') p.classList.remove('active-page');
        });
        // 清除侧栏高亮
        document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => item.classList.remove('active'));
        if (pageTitle) pageTitle.innerText = '南大图谱';
        showHomePage();
    }
}

// 移动端侧栏控制
function openSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.add('open');
    let overlay = document.getElementById('sidebarOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'sidebarOverlay';
        overlay.className = 'sidebar-overlay';
        overlay.onclick = closeSidebar;
        document.body.appendChild(overlay);
    }
    overlay.classList.add('show');
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('open');
    const overlay = document.getElementById('sidebarOverlay');
    if (overlay) overlay.classList.remove('show');
}

// 处理邮箱验证 URL
function handleEmailVerification() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    if (token) {
        import('./api.js').then(({ verifyEmail }) => {
            verifyEmail(token).then(() => {
                showToast('邮箱验证成功！');
                window.location.href = window.location.pathname;
            }).catch(() => {
                showToast('验证链接无效或已过期');
            });
        });
    }
}

// 全局登出
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await doLogout();
    updateNavBar();
    showToast('已退出登录');
});

// 侧栏导航链接点击
document.querySelectorAll('.sidebar-nav .nav-item[data-page]').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.getAttribute('data-page');
        switchPage(page);
    });
});

// 移动端菜单按钮
document.getElementById('menuToggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openSidebar();
});

// 关闭模态框（登录弹窗）
document.getElementById('closeAuthModalBtn')?.addEventListener('click', () => {
    document.getElementById('authModal').style.display = 'none';
});
document.getElementById('authModal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        document.getElementById('authModal').style.display = 'none';
    }
});

// 初始化应用
function init() {
    handleEmailVerification();
    updateNavBar();
    // 预先加载各个模块的初始化（不重复绑定）
    initRestaurantsPage();
    initMapPage();
    initAIPage();
    initProfilePage();
}

// 暴露给全局（方便其他模块调用）
window.switchPage = switchPage;
window.updateNavBar = updateNavBar;

init();
