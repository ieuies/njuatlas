import { prefetchAmapScript } from '../../config.js';
import { partnerStore } from './shared.js';
import { loadPostsByPage, handleParticipate, initPartnerPagination } from './list.js';
import { schedulePartnerPrefetch } from './prefetch.js';
import {
    schedulePreviewMapAfterPosts, refreshPreviewMarkers, initFullMapMarkers,
    addMarkersToMap, getOrCreateSharedMap, scheduleMobileMapPrewarm,
} from './map.js';
import { initPostDetailModal, openPostDetail } from './post-detail.js';
import { initPartnerModal } from './partner-form.js';
import { initFilters, setupCategoryScrollArrows, initPartnerSearch, initPartnerDurationToggle } from './filters.js';
import { isMobileViewport } from '../../utils.js';

// ============================================================
// 页面入口 & 初始化
// ============================================================

function schedulePreviewMapAfterPaint() {
    if (isMobileViewport()) return;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => schedulePreviewMapAfterPosts());
    });
}

export async function loadPartnerData() {
    if (!partnerStore.filtersInited) {
        initFilters();
        initPartnerSearch();
        initPartnerDurationToggle();
        partnerStore.filtersInited = true;
    }

    if (partnerStore.partnerDataLoaded) {
        scheduleMobileMapPrewarm();
        if (partnerStore.currentMapParent === 'full') {
            const map = getOrCreateSharedMap('preview');
            if (map) {
                addMarkersToMap(map, partnerStore.partnersData);
            }
        }
        return;
    }

    partnerStore.partnerDataLoaded = true;
    // 与帖子请求并行预拉高德 SDK，地图仍在帖子完成后再初始化
    prefetchAmapScript();
    await loadPostsByPage(1);
    schedulePreviewMapAfterPaint();
    scheduleMobileMapPrewarm();
    schedulePartnerPrefetch();
}

function ensureRightPanel() {
    const page = document.getElementById('partnerPage');
    if (!page) return;

    const toolbar = page.querySelector('.partner-list-toolbar');
    const container = page.querySelector('.filter-slider-container');
    const waterfall = page.querySelector('.partner-waterfall');
    const pagination = page.querySelector('.partner-pagination');
    if (!container || !waterfall) return;

    let panel = page.querySelector('.partner-right-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.className = 'partner-right-panel';
        page.insertBefore(panel, toolbar || container);
        if (toolbar) panel.appendChild(toolbar);
        panel.appendChild(container);
        panel.appendChild(waterfall);
        if (pagination) panel.appendChild(pagination);
        return;
    }

    if (toolbar && toolbar.parentElement !== panel) panel.insertBefore(toolbar, panel.firstChild);
    if (container.parentElement !== panel) panel.appendChild(container);
    if (waterfall.parentElement !== panel) panel.appendChild(waterfall);
    if (pagination && pagination.parentElement !== panel) panel.appendChild(pagination);
}

export async function initPartnerPage() {
    initPartnerModal();
    initPostDetailModal();
    initPartnerPagination();

    setupCategoryScrollArrows();
    ensureRightPanel();

    const partnerPage = document.getElementById('partnerPage');
    if (partnerPage) {
        const observer = new MutationObserver(() => {
            if (partnerPage.classList.contains('active-page')) {
                setTimeout(() => window._refreshCategoryArrows?.(), 100);
            }
        });
        observer.observe(partnerPage, { attributes: true, attributeFilter: ['class'] });
    }

    if (!partnerStore.partnerPageInitialized) {
        partnerStore.partnerPageInitialized = true;
        window.addEventListener('resize', () => {
            setTimeout(() => window._refreshCategoryArrows?.(), 150);
        });
    }
}

// 暴露全局方法


document.addEventListener('click', (e) => {
    const btn = e.target.closest('.map-join-btn');
    if (!btn) return;
    const postId = parseInt(btn.getAttribute('data-post-id'));
    if (postId) handleParticipate(postId);
});

window.initPartnerPage = initPartnerPage;
window.loadPartnerData = loadPartnerData;
window.initFullMapMarkers = initFullMapMarkers;
window.setupCategoryScrollArrows = setupCategoryScrollArrows;
window.forceShowArrows = function () {
    document.querySelectorAll('.scroll-arrow').forEach(arrow => {
        arrow.classList.remove('is-hidden');
        arrow.style.visibility = 'visible';
        arrow.style.opacity = '1';
        arrow.style.display = 'flex';
    });
};
window.checkOverflow = function () {
    const wrapper = document.querySelector('.filter-scroll-wrapper');
    if (!wrapper) return;
    const maxScroll = wrapper.scrollWidth - wrapper.clientWidth;
    console.log('[checkOverflow]', {
        scrollWidth: wrapper.scrollWidth,
        clientWidth: wrapper.clientWidth,
        maxScroll,
        hasOverflow: maxScroll > 2,
        scrollLeft: wrapper.scrollLeft,
    });
};

export { openPostDetail, initFilters, setupCategoryScrollArrows, initPartnerSearch, initPartnerDurationToggle };
export { prefetchPartnerList } from './prefetch.js';
