import { partnerStore } from './shared.js';
import { loadPostsByPage, handleScroll, handleParticipate } from './list.js';
import {
    initPreviewMap, refreshPreviewMarkers, initFullMapMarkers,
    addMarkersToMap, getOrCreateSharedMap,
} from './map.js';
import { initPostDetailModal, openPostDetail } from './post-detail.js';
import { initPartnerModal } from './partner-form.js';
import { initFilters, setupCategoryScrollArrows } from './filters.js';

// ============================================================
// 页面入口 & 初始化
// ============================================================

export async function loadPartnerData() {
    if (partnerStore.partnerDataLoaded) {
        if (partnerStore.currentMapParent === 'full') {
            const map = getOrCreateSharedMap('preview');
            if (map) {
                addMarkersToMap(map, partnerStore.partnersData);
            }
        }
        return;
    }
    partnerStore.partnerDataLoaded = true;
    initFilters();
    await loadPostsByPage(1, false);
    initPreviewMap();
}

function ensureRightPanel() {
    const page = document.getElementById('partnerPage');
    if (!page) return;

    const container = page.querySelector('.filter-slider-container');
    const waterfall = page.querySelector('.partner-waterfall');
    if (!container || !waterfall) return;

    let panel = page.querySelector('.partner-right-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.className = 'partner-right-panel';
        page.insertBefore(panel, container);
        panel.appendChild(container);
        panel.appendChild(waterfall);
        return;
    }

    if (container.parentElement !== panel) panel.appendChild(container);
    if (waterfall.parentElement !== panel) panel.appendChild(waterfall);
}

export async function initPartnerPage() {
    initPartnerModal();
    initPostDetailModal();

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
        // 注册滚动监听
        window.addEventListener('scroll', handleScroll);
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

export { openPostDetail };
