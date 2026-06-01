import { initPartnerPage } from './pages/partner.js';
import { isLoggedIn, getUser, doLogout } from './auth.js';
import { showToast } from './utils.js';
import { showHomePage } from './pages/home.js';
import { initRestaurantsPage, refreshRestaurants, initMapPage } from './pages/restaurants.js';
import { initAIPage } from './pages/ai.js';
import { initProfilePage, refreshProfile } from './pages/profile.js';
import { loadAmapScript } from './config.js';

let currentPage = null;

const pageTitles = {
    restaurants: '餐厅',
    map: '地图',
    ai: 'AI助手',
    scenic: '景点',
    profile: '个人中心',
    partner: '找搭子',   // 新增
};

function switchPage(pageId) {
    if (pageId === 'profile' && !isLoggedIn()) {
        const modal = document.getElementById('authModal');
        if (modal) modal.style.display = 'flex';
        return;
    }

    document.querySelectorAll('.content-area .page').forEach(page => {
        page.classList.remove('active-page');
    });

    const target = document.getElementById(`${pageId}Page`);
    if (target) {
        target.classList.add('active-page');
        const titleEl = document.getElementById('pageTitle');
        if (titleEl && pageTitles[pageId]) titleEl.innerText = pageTitles[pageId];
    }
    currentPage = pageId;

    document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-page') === pageId);
    });

    // 页面切换时调用的刷新逻辑
    if (pageId === 'restaurants') refreshRestaurants();
    else if (pageId === 'map') initMapPage();
    else if (pageId === 'profile') refreshProfile();
    else if (pageId === 'partner') initPartnerPage();  // 新增

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
        document.body.classList.add('logged-in');

        const user = getUser();
        if (usernameSpan) {
            if (user) usernameSpan.innerText = user.username || user.email.split('@')[0];
            usernameSpan.onclick = () => switchPage('profile');
        }
        if (homePage) homePage.classList.remove('active-page');
        if (pageTitle) pageTitle.innerText = pageTitles.restaurants;
        if (!currentPage) switchPage('restaurants');
        return;
    }

    if (guestNav) guestNav.style.display = 'flex';
    if (userNav) userNav.style.display = 'none';
    document.body.classList.remove('logged-in');
    currentPage = null;

    if (homePage) homePage.classList.add('active-page');
    document.querySelectorAll('.content-area .page').forEach(page => {
        if (page.id !== 'homePage') page.classList.remove('active-page');
    });
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => item.classList.remove('active'));
    if (pageTitle) pageTitle.innerText = '南大图谱';
    showHomePage();
}

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
    if (sidebar) sidebar.classList.remove('open');
    const overlay = document.getElementById('sidebarOverlay');
    if (overlay) overlay.classList.remove('show');
}

function handleEmailVerification() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    if (!token) return;

    import('./api.js').then(({ verifyEmail }) => {
        verifyEmail(token).then(() => {
            showToast('邮箱验证成功');
            window.location.href = window.location.pathname;
        }).catch(() => {
            showToast('验证链接无效或已过期');
        });
    });
}

document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await doLogout();
    updateNavBar();
    showToast('已退出登录');
});

document.querySelectorAll('.sidebar-nav .nav-item[data-page]').forEach(link => {
    link.addEventListener('click', event => {
        event.preventDefault();
        switchPage(link.getAttribute('data-page'));
    });
});

document.getElementById('menuToggle')?.addEventListener('click', event => {
    event.stopPropagation();
    openSidebar();
});

document.getElementById('closeAuthModalBtn')?.addEventListener('click', () => {
    document.getElementById('authModal').style.display = 'none';
});

document.getElementById('authModal')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) {
        document.getElementById('authModal').style.display = 'none';
    }
});

function init() {
    handleEmailVerification();
    updateNavBar();
    loadAmapScript().catch(error => {
        console.warn('Failed to load AMap script:', error);
    });
    initRestaurantsPage();
    initAIPage();
    initProfilePage();
}

window.switchPage = switchPage;
window.updateNavBar = updateNavBar;

init();
