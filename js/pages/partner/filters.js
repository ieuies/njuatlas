import { escapeHtml } from '../../utils.js';
import { categoryChipHtml, debounce, partnerStore } from './shared.js';
import { switchCategory, switchSearch, switchUrgencyScope } from './list.js';
import { t } from '../../i18n.js';

// ============================================================
// 分类筛选（固定分类，动态生成）
// ============================================================
const FIXED_CATEGORIES = [
    { label: '全部', category: 'all' },
    { label: '饭搭子', icon: 'fa-utensils', category: '饭搭子' },
    { label: '运动搭子', icon: 'fa-futbol', category: '运动搭子' },
    { label: '学习搭子', icon: 'fa-book', category: '学习搭子' },
    { label: '游戏搭子', icon: 'fa-gamepad', category: '游戏搭子' },
    { label: '电影搭子', icon: 'fa-film', category: '电影搭子' },
    { label: '旅游搭子', icon: 'fa-plane', category: '旅游搭子' },
    { label: '音乐搭子', icon: 'fa-music', category: '音乐搭子' },
    { label: '摄影搭子', icon: 'fa-camera', category: '摄影搭子' },
    { label: '其他', icon: 'fa-ellipsis', category: '其他' },
];

export function initFilters() {
    const container = document.getElementById('partnerFilter');
    if (!container) return;

    const activeCategory = container.querySelector('.filter-chip.active')?.getAttribute('data-category')
        || partnerStore.currentCategory
        || 'all';

    container.innerHTML = FIXED_CATEGORIES.map((c) =>
        `<span class="filter-chip${c.category === activeCategory ? ' active' : ''}" data-category="${escapeHtml(c.category)}">${categoryChipHtml(c)}</span>`
    ).join('');

    container.querySelectorAll('.filter-chip').forEach(chip => {
        chip.style.flexShrink = '0';
        chip.addEventListener('click', () => {
            const category = chip.getAttribute('data-category');
            container.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            switchCategory(category);
        });
    });

    setupCategoryScrollArrows();
}

export function initPartnerDurationToggle() {
    const toggle = document.getElementById('partnerDurationToggle');
    if (!toggle || toggle.dataset.bound === 'true') return;
    toggle.dataset.bound = 'true';

    const syncActive = (scope) => {
        toggle.querySelectorAll('.partner-duration-option').forEach((btn) => {
            const active = btn.getAttribute('data-scope') === scope;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
    };

    syncActive(partnerStore.urgencyScope || 'short');

    toggle.querySelectorAll('.partner-duration-option').forEach((btn) => {
        btn.addEventListener('click', () => {
            const scope = btn.getAttribute('data-scope');
            if (!scope || scope === partnerStore.urgencyScope) return;
            syncActive(scope);
            switchUrgencyScope(scope);
        });
    });
}

export function initPartnerSearch() {
    const input = document.getElementById('partnerSearchInput');
    const clearBtn = document.getElementById('partnerSearchClear');
    if (!input || input.dataset.bound === 'true') return;
    input.dataset.bound = 'true';

    const syncClear = () => {
        if (clearBtn) clearBtn.hidden = !input.value.trim();
    };

    const runSearch = debounce(() => {
        switchSearch(input.value);
    }, 320);

    input.addEventListener('input', () => {
        syncClear();
        runSearch();
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            switchSearch(input.value);
        }
    });

    clearBtn?.addEventListener('click', () => {
        input.value = '';
        syncClear();
        switchSearch('');
        input.focus();
    });

    syncClear();
}

export function setupCategoryScrollArrows() {
    const originalFilter = document.getElementById('partnerFilter');
    if (!originalFilter) return;

    const existingContainer = originalFilter.closest('.filter-slider-container');
    if (existingContainer) {
        bindArrowEvents(existingContainer);
        requestAnimationFrame(() => window._refreshCategoryArrows?.());
        return;
    }

    const parent = originalFilter.parentNode;
    const container = document.createElement('div');
    container.className = 'filter-slider-container';

    const leftArrow = document.createElement('button');
    leftArrow.className = 'scroll-arrow scroll-arrow-left';
    leftArrow.innerHTML = '<i class="fas fa-chevron-left"></i>';
    leftArrow.setAttribute('aria-label', t('filter.scrollLeft'));

    const rightArrow = document.createElement('button');
    rightArrow.className = 'scroll-arrow scroll-arrow-right';
    rightArrow.innerHTML = '<i class="fas fa-chevron-right"></i>';
    rightArrow.setAttribute('aria-label', t('filter.scrollRight'));

    const scrollWrapper = document.createElement('div');
    scrollWrapper.className = 'filter-scroll-wrapper';

    container.appendChild(leftArrow);
    container.appendChild(scrollWrapper);
    container.appendChild(rightArrow);
    parent.insertBefore(container, originalFilter);
    scrollWrapper.appendChild(originalFilter);

    bindArrowEvents(container);
    window.addEventListener('resize', () => window._refreshCategoryArrows?.());

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            requestAnimationFrame(() => window._refreshCategoryArrows?.());
        });
    }
    setTimeout(() => window._refreshCategoryArrows?.(), 100);
    setTimeout(() => window._refreshCategoryArrows?.(), 500);
}

function bindArrowEvents(container) {
    const leftArrow = container.querySelector('.scroll-arrow-left');
    const rightArrow = container.querySelector('.scroll-arrow-right');
    const scrollWrapper = container.querySelector('.filter-scroll-wrapper');
    if (!leftArrow || !rightArrow || !scrollWrapper) return;

    const scrollStep = (direction) => {
        const amount = Math.max(180, scrollWrapper.clientWidth * 0.75);
        const target = scrollWrapper.scrollLeft + (direction === 'left' ? -amount : amount);
        scrollWrapper.scrollTo({ left: target, behavior: 'smooth' });
    };

    leftArrow.addEventListener('click', (e) => { e.stopPropagation(); scrollStep('left'); });
    rightArrow.addEventListener('click', (e) => { e.stopPropagation(); scrollStep('right'); });

    const updateState = () => {
        const maxScroll = scrollWrapper.scrollWidth - scrollWrapper.clientWidth;
        const current = scrollWrapper.scrollLeft;
        const hasOverflow = maxScroll > 2;

        if (hasOverflow) {
            const showLeft = current > 2;
            const showRight = current < maxScroll - 2;
            leftArrow.classList.toggle('is-hidden', !showLeft);
            rightArrow.classList.toggle('is-hidden', !showRight);
        } else {
            leftArrow.classList.add('is-hidden');
            rightArrow.classList.add('is-hidden');
        }

        scrollWrapper.classList.toggle('has-mask-left', hasOverflow && current > 2);
        scrollWrapper.classList.toggle('has-mask-right', hasOverflow && current < maxScroll - 2);
    };

    scrollWrapper.addEventListener('scroll', () => requestAnimationFrame(updateState), { passive: true });

    if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => requestAnimationFrame(updateState));
        ro.observe(scrollWrapper);
    }

    window._refreshCategoryArrows = updateState;
    requestAnimationFrame(updateState);
}