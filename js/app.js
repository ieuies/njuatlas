import { isLoggedIn, getUser, doLogout, resendVerificationEmail, updateUserFromLogin } from './auth.js';
import { showToast } from './utils.js';
import { showHomePage, hideHomePage } from './pages/home.js';
import { initRestaurantsPage, refreshRestaurants, initMapPage } from './pages/restaurants.js';
import { initAIPage } from './pages/ai.js';
import { initProfilePage, refreshProfile } from './pages/profile.js';

let currentPage = null;

function switchPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active-page'));
    const target = document.getElementById(`${pageId}Page`);
    if (target) target.classList.add('active-page');
    currentPage = pageId;

    // 刷新对应页面数据
    if (pageId === 'restaurants') refreshRestaurants();
    else if (pageId === 'map') initMapPage();
    else if (pageId === 'profile') refreshProfile();
    else if (pageId === 'ai') { /* AI 页面无需主动刷新 */ }
}

function updateNavBar() {
    const guestNav = document.getElementById('navGuest');
    const userNav = document.getElementById('navUser');
    const usernameSpan = document.getElementById('usernameSpan');
    if (isLoggedIn()) {
        guestNav.style.display = 'none';
        userNav.style.display = 'flex';
        const user = getUser();
        if (user) usernameSpan.innerText = user.username || user.email.split('@')[0];
        document.getElementById('appContainer').style.display = 'block';
        document.getElementById('homePage').style.display = 'none';
        document.body.classList.remove('body-hero');
        // 默认显示餐厅页
        switchPage('restaurants');
    } else {
        guestNav.style.display = 'flex';
        userNav.style.display = 'none';
        document.getElementById('appContainer').style.display = 'none';
        document.getElementById('homePage').style.display = 'block';
        document.body.classList.add('body-hero');
        showHomePage();
    }
}

// 处理邮箱验证 URL
function handleEmailVerification() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    if (token) {
        import('./api.js').then(({ verifyEmail }) => {
            verifyEmail(token).then(() => {
                showToast('邮箱验证成功！');
                // 刷新用户信息（可以重新登录或刷新页面）
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

// 导航链接点击
document.querySelectorAll('[data-page]').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.getAttribute('data-page');
        switchPage(page);
    });
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