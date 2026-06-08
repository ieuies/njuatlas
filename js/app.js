import { isLoggedIn, getUser, doLogout } from './auth.js';
import { showToast } from './utils.js';
import { showHomePage } from './pages/home.js';

// ── 动态加载 CSS（避免重复加载）────────────────────────────────
const loadedStyles = new Set();

function seedLoadedStyles() {
    document.querySelectorAll('link[rel="stylesheet"][href]').forEach((link) => {
        const href = link.getAttribute('href');
        if (href) loadedStyles.add(href);
    });
}

function loadStyle(href) {
    if (loadedStyles.has(href)) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.onload = () => {
            loadedStyles.add(href);
            resolve();
        };
        link.onerror = reject;
        document.head.appendChild(link);
    });
}

// ── 按需懒加载：大模块（partner 63KB / guide 10KB / profile 21KB）在首次导航时才下载 ──
let _partnerMod = null;
let _guideMod = null;
let _profileMod = null;
let _aiMod = null;
let _partnerPageInited = false;
let _profilePageInited = false;
function _loadPartner() { return _partnerMod || (_partnerMod = import('./pages/partner.js')); }
function _loadGuide()   { return _guideMod   || (_guideMod   = import('./pages/guide.js')); }
function _loadProfile() { return _profileMod || (_profileMod = import('./pages/profile.js')); }
function _loadAI()      { return _aiMod      || (_aiMod      = import('./pages/ai.js')); }

// 延迟导入 openPostDetail，避免循环依赖
let openPostDetailFn = null;
async function getOpenPostDetail() {
    if (!openPostDetailFn) {
        const mod = await _loadPartner();
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

const PAGE_STYLES = {
    guide: ['css/guide.css'],
    ai: ['css/ai.css'],
    partner: ['css/partner.css', 'css/components.css'],
    profile: ['css/profile.css', 'css/components.css'],
    fullMap: ['css/partner.css'],
};

async function ensurePageStyles(pageId) {
    const sheets = PAGE_STYLES[pageId];
    if (!sheets?.length) return;
    await Promise.all(sheets.map((href) => loadStyle(href)));
}

function prefetchPageModule(pageId) {
    if (pageId === 'partner' || pageId === 'fullMap') return _loadPartner();
    if (pageId === 'guide') return _loadGuide();
    if (pageId === 'profile') return _loadProfile();
    if (pageId === 'ai') return _loadAI();
    return Promise.resolve();
}

function prefetchCommonAssets() {
    const run = (cb) => {
        if (window.requestIdleCallback) window.requestIdleCallback(cb, { timeout: 4000 });
        else setTimeout(cb, 1200);
    };
    run(() => {
        ['css/partner.css', 'css/guide.css', 'css/profile.css', 'css/components.css', 'css/ai.css']
            .forEach((href) => loadStyle(href));
        _loadPartner();
        _loadGuide();
        _loadProfile();
        _loadAI();
    });
}

async function switchPage(pageId) {
    // 这些页面沿用现有登录模态框；这里不改账号流程，只把入口统一接到已有 authModal。
    const protectedPages = ['profile'];
    if (protectedPages.includes(pageId) && !isLoggedIn()) {
        const modal = document.getElementById('authModal');
        if (modal) modal.style.display = 'flex';
        return;
    }

    await Promise.all([
        ensurePageStyles(pageId),
        prefetchPageModule(pageId),
    ]);

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

    // 页面切换时的初始化（大模块按需动态加载）
    if (pageId === 'guide') {
        const mod = await _loadGuide();
        mod.initGuidePage();
    } else if (pageId === 'ai') {
        const mod = await _loadAI();
        mod.initAIPage();
    } else if (pageId === 'partner') {
        const mod = await _loadPartner();
        // 首次加载时初始化模态框等
        if (!_partnerPageInited) {
            _partnerPageInited = true;
            mod.initPartnerPage();
        }
        mod.loadPartnerData();
    } else if (pageId === 'profile') {
        const mod = await _loadProfile();
        // 首次加载时绑定编辑资料等按钮事件
        if (!_profilePageInited) {
            _profilePageInited = true;
            mod.initProfilePage();
        }
        mod.refreshProfile();
    } else if (pageId === 'fullMap') {
        // 确保 partner 模块已加载（全屏地图需要 initFullMapMarkers）
        await _loadPartner();
        requestAnimationFrame(() => {
            requestAnimationFrame(() => initFullMapMarkers());
        });
    }

    if (pageId === 'home') {
        window._resumeHomeParticles?.();
    } else {
        window._pauseHomeParticles?.();
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
        if (themeButton) {
            themeButton.innerHTML = theme === 'dark'
                ? '<i class="fas fa-sun" aria-hidden="true"></i>'
                : '<i class="fas fa-moon" aria-hidden="true"></i>';
        }
        localStorage.setItem('njuatlas-theme', theme);
    };

    applyTheme(savedTheme);

    themeButton?.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });
}

// ========== 首页粒子背景 ==========
function initHomeParticles() {
    const canvas = document.getElementById('homeParticleCanvas');
    if (!canvas || canvas.dataset.ready === 'true') return;
    canvas.dataset.ready = 'true';

    const ctx = canvas.getContext('2d');
    let particles = [];
    let mouseX = -9999, mouseY = -9999, mouseOn = false;
    let animId;

    function resize() {
        const rect = canvas.parentElement.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
    }

    function getColors() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        return isDark ? [180, 170, 220] : [140, 100, 210];
    }

    function initParticles() {
        const w = canvas.width / (Math.min(window.devicePixelRatio || 1, 2));
        const h = canvas.height / (Math.min(window.devicePixelRatio || 1, 2));
        const count = Math.floor(w * h / 3500);
        particles = [];
        for (let i = 0; i < count; i++) {
            particles.push({
                x: Math.random() * w, y: Math.random() * h,
                vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
                r: Math.random() * 2 + 0.8,
                phase: Math.random() * Math.PI * 2,
            });
        }
    }

    function render() {
        const w = canvas.width / (Math.min(window.devicePixelRatio || 1, 2));
        const h = canvas.height / (Math.min(window.devicePixelRatio || 1, 2));
        const [pr, pg, pb] = getColors();
        const t = performance.now() * 0.001;

        ctx.clearRect(0, 0, w, h);

        for (const p of particles) {
            // 有机漂移
            p.vx += Math.sin(t * 0.7 + p.phase) * 0.015;
            p.vy += Math.cos(t * 0.6 + p.phase) * 0.015;

            // 鼠标排斥
            if (mouseOn) {
                const dx = p.x - mouseX, dy = p.y - mouseY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 120 && dist > 0.5) {
                    const f = (1 - dist / 120) * 1.5;
                    p.vx += (dx / dist) * f;
                    p.vy += (dy / dist) * f;
                }
            }

            p.vx *= 0.96; p.vy *= 0.96;
            p.x += p.vx; p.y += p.vy;
            if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
            if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;

            const alpha = 0.4 + Math.sin(t * 0.5 + p.phase) * 0.15;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${pr},${pg},${pb},${alpha})`;
            ctx.fill();
        }

        // 粒子连线
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 100) {
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `rgba(${pr},${pg},${pb},${0.06 * (1 - dist / 100)})`;
                    ctx.stroke();
                }
            }
        }

        if (document.getElementById('homePage')?.classList.contains('active-page')) {
            animId = requestAnimationFrame(render);
        } else {
            animId = null;
        }
    }

    window._pauseHomeParticles = () => {
        if (animId) {
            cancelAnimationFrame(animId);
            animId = null;
        }
    };
    window._resumeHomeParticles = () => {
        if (!animId && document.getElementById('homePage')?.classList.contains('active-page')) {
            render();
        }
    };

    resize(); initParticles(); render();

    // 鼠标监听挂在 #homePage 上（canvas 是 pointer-events:none）
    const homePage = document.getElementById('homePage');
    homePage.addEventListener('mousemove', e => {
        const rect = canvas.getBoundingClientRect();
        mouseX = e.clientX - rect.left;
        mouseY = e.clientY - rect.top;
        mouseOn = true;
    }, { passive: true });
    homePage.addEventListener('mouseleave', () => { mouseOn = false; });
    homePage.addEventListener('touchmove', e => {
        const rect = canvas.getBoundingClientRect();
        mouseX = e.touches[0].clientX - rect.left;
        mouseY = e.touches[0].clientY - rect.top;
        mouseOn = true;
    }, { passive: true });
    homePage.addEventListener('touchend', () => { mouseOn = false; });

    let rt;
    window.addEventListener('resize', () => {
        clearTimeout(rt);
        rt = setTimeout(() => { if (animId) cancelAnimationFrame(animId); resize(); initParticles(); render(); }, 350);
    });

    canvas._cleanup = () => { if (animId) cancelAnimationFrame(animId); };
}

// ========== 移动端首页图片网格（6×7） ==========
function initMobileGrid() {
    const grid = document.getElementById('homeMobileGrid');
    if (!grid || grid.dataset.ready === 'true') return;
    grid.dataset.ready = 'true';

    const imgs = [
        'image/landmarks/beida.jpg',
        'image/landmarks/exercise.jpg',
        'image/landmarks/gate.jpg',
        'image/landmarks/liberary.jpg',
        'image/landmarks/meat.jpg',
        'image/landmarks/nailong.jpg',
        'image/landmarks/sushi.jpg',
        'image/landmarks/zifeng.jpg',
    ];

    // 42个格子，随机取图
    const cells = [];
    for (let i = 0; i < 42; i++) {
        cells.push(imgs[Math.floor(Math.random() * imgs.length)]);
    }

    const frag = document.createDocumentFragment();
    cells.forEach(src => {
        const div = document.createElement('div');
        div.className = 'mg-cell';
        div.style.backgroundImage = `url('${src}')`;
        frag.appendChild(div);
    });
    grid.appendChild(frag);
}

// ========== 首页卡片网格（9行等大错位 + 翻转） ==========
function initHomeCards() {
    const grid = document.getElementById('homeCardGrid');
    if (!grid || grid.dataset.ready === 'true') return;
    grid.dataset.ready = 'true';

    const landmarks = [
        'image/landmarks/beida.jpg',
        'image/landmarks/exercise.jpg',
        'image/landmarks/gate.jpg',
        'image/landmarks/liberary.jpg',
        'image/landmarks/meat.jpg',
        'image/landmarks/nailong.jpg',
        'image/landmarks/sushi.jpg',
        'image/landmarks/zifeng.jpg',
    ];

    // 6行，基础6列，突出行向左多伸
    const rowCounts = [6, 7, 6, 9, 8, 6];
    rowCounts.forEach(count => {
        const row = document.createElement('div');
        row.className = 'home-card-row';
        for (let c = 0; c < count; c++) {
            const img = landmarks[Math.floor(Math.random() * landmarks.length)];
            const card = document.createElement('div');
            card.className = 'home-flip-card';
            card.innerHTML = `
                <div class="home-flip-inner">
                    <div class="home-flip-front"></div>
                    <div class="home-flip-back" style="background-image:url('${img}')"></div>
                </div>
            `;
            row.appendChild(card);
        }
        grid.appendChild(row);
    });
    // 添加交错入场动画：随机顺序、较快的间隔
    // 使用 Fisher-Yates 洗牌，让出现顺序更随机
    const cards = Array.from(grid.querySelectorAll('.home-flip-card'));
    for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    // 更快的间隔：30ms，每个卡片动画时长由 CSS 控制
    const STAGGER_MS = 30;
    cards.forEach((el, idx) => {
        const delay = idx * STAGGER_MS;
        setTimeout(() => el.classList.add('enter'), delay);
    });

    // 为每个卡片添加指针进入/离开逻辑：经过立即翻转，离开延迟翻回
    const MIN_VISIBLE_MS = 200; // 最小翻转可见时长
    const LEAVE_DELAY_MS = 200;  // 鼠标离开后延迟翻回
    cards.forEach(card => {
        let enterTime = 0;
        let leaveTimer = null;

        card.addEventListener('pointerenter', () => {
            // 进入时立即显示翻转状态
            if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
            card.classList.add('flipped');
            enterTime = Date.now();
        });

        card.addEventListener('pointerleave', () => {
            // 确保至少保持 MIN_VISIBLE_MS 再翻回
            const elapsed = Date.now() - enterTime;
            const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
            if (leaveTimer) clearTimeout(leaveTimer);
            leaveTimer = setTimeout(() => {
                card.classList.remove('flipped');
                leaveTimer = null;
            }, remaining + LEAVE_DELAY_MS);
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
async function init() {
    seedLoadedStyles();
    updateNavBar();

    // 初始化各模块
    showHomePage();          // 绑定登录/注册/找回密码等按钮事件
    initNavigation();
    initThemeToggle();
    initHomeParticles();
    const deferHeavyHome = window.requestIdleCallback || ((cb) => setTimeout(cb, 0));
    deferHeavyHome(() => {
        initHomeCards();
        initMobileGrid();
    });
    initFabButton();
    initMapExpand();
    initFullMapPage();

    // 默认加载首页。partner / profile 等大模块由 switchPage 按需懒加载。
    await switchPage('home');
    prefetchCommonAssets();
}

// 全局事件
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await doLogout();
    updateNavBar();
    switchPage('home');
    showToast('已退出登录');
});

document.getElementById('closeAuthModalBtn')?.addEventListener('click', () => {
    const authModal = document.getElementById('authModal');
    if (authModal) authModal.style.display = 'none';
});

document.getElementById('authModal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        e.currentTarget.style.display = 'none';
    }
});

// 暴露给全局
window.switchPage = switchPage;
window.updateNavBar = updateNavBar;

init();
