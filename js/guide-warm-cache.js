/** 吃喝玩乐首屏 warm cache：app 预取与 guide 页共用，进页前即可同步绘制 */

export const GUIDE_LB_CACHE_KEY = 'njuatlas_guide_lb_v1';
export const GUIDE_CACHE_TTL_MS = 3 * 60 * 1000;
export const GUIDE_ENTRY_CAMPUS = '鼓楼';
export const GUIDE_ENTRY_CATEGORY = '美食';
export const ALL_GUIDE_CAMPUSES = ['鼓楼', '仙林', '浦口', '苏州', 'all'];
export const ALL_GUIDE_CATEGORIES = ['美食', '咖啡饮品', '休闲娱乐', '运动健身', '购物商圈', '景点公园'];
const IMG_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='200' fill='%23e8e4f0'/%3E";

export function entryCacheKey(campus = GUIDE_ENTRY_CAMPUS, category = GUIDE_ENTRY_CATEGORY) {
    return `${campus}\x1f${category}`;
}

function esc(str) {
    if (str == null || str === '') return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function secureImageUrl(url) {
    if (!url) return '';
    return String(url).replace(/^http:\/\//i, 'https://');
}

export function readLeaderboardRow(key) {
    try {
        const map = JSON.parse(sessionStorage.getItem(GUIDE_LB_CACHE_KEY) || '{}');
        const row = map[key];
        if (!row || Date.now() - row.at > GUIDE_CACHE_TTL_MS) return null;
        return row;
    } catch {
        return null;
    }
}

export function readLeaderboardFromStorage(key) {
    return readLeaderboardRow(key)?.data ?? null;
}

export function persistLeaderboardToStorage(key, data) {
    const at = Date.now();
    const row = { at, data };

    const writeMap = (map) => {
        map[key] = row;
        sessionStorage.setItem(GUIDE_LB_CACHE_KEY, JSON.stringify(map));
    };

    try {
        writeMap(JSON.parse(sessionStorage.getItem(GUIDE_LB_CACHE_KEY) || '{}'));
    } catch {
        try {
            const map = JSON.parse(sessionStorage.getItem(GUIDE_LB_CACHE_KEY) || '{}');
            const dropKeys = Object.keys(map)
                .filter((k) => !k.startsWith('all\x1f') && k !== entryCacheKey())
                .sort((a, b) => (map[a]?.at || 0) - (map[b]?.at || 0));
            for (const k of dropKeys.slice(0, Math.max(dropKeys.length - 8, 0))) {
                delete map[k];
            }
            writeMap(map);
        } catch { /* quota */ }
    }

    if (typeof window !== 'undefined') {
        window.__njuatlasGuideLbWarm = { key, data, at };
    }
}

export function readWarmLeaderboard(key) {
    const warm = typeof window !== 'undefined' ? window.__njuatlasGuideLbWarm : null;
    if (warm?.key === key && warm.data && Date.now() - warm.at < GUIDE_CACHE_TTL_MS) {
        return warm.data;
    }
    return readLeaderboardFromStorage(key);
}

function topRankBadge(rank) {
    if (rank === 1) {
        return '<div class="guide-top-badge guide-top-badge--1"><i class="fas fa-crown" aria-hidden="true"></i><span>TOP 1</span></div>';
    }
    if (rank === 2) {
        return '<div class="guide-top-badge guide-top-badge--2"><span>TOP 2</span></div>';
    }
    if (rank === 3) {
        return '<div class="guide-top-badge guide-top-badge--3"><span>TOP 3</span></div>';
    }
    return '';
}

function cardHtml(item, idx) {
    const likes = item.like_count || 0;
    const reviews = item.review_count || 0;
    const rank = item.rank || (idx + 1);
    const dist = item.distance_label || (item.distance_m != null ? `${item.distance_m}m` : '');
    const topClass = rank <= 3 ? ` guide-waterfall-card--top${rank}` : '';
    const imgSrc = secureImageUrl(item.image) || IMG_PLACEHOLDER;
    const eager = idx < 3 && imgSrc !== IMG_PLACEHOLDER;
    const imgTag = eager
        ? `<img class="guide-card-cover-img" src="${imgSrc}" alt="${esc(item.name)}" loading="eager" decoding="async" fetchpriority="high">`
        : `<img class="guide-card-cover-img" src="${IMG_PLACEHOLDER}" data-src="${imgSrc}" alt="${esc(item.name)}" loading="lazy" decoding="async">`;

    return `
        <article class="guide-waterfall-card${topClass}" data-guide-idx="${idx}" data-guide-name="${esc(item.name)}" data-warm-shell="1">
            ${topRankBadge(rank)}
            <div class="guide-card-cover">${imgTag}</div>
            <div class="guide-card-body">
                <h3 class="guide-card-name">${esc(item.name)}</h3>
                <div class="guide-card-stats">
                    <span class="guide-stat guide-stat--likes"><i class="fas fa-heart" aria-hidden="true"></i> ${likes} 赞</span>
                    ${item.rating ? `<span class="guide-stat guide-stat--rating"><i class="fas fa-star" aria-hidden="true"></i> ${esc(String(item.rating))}</span>` : ''}
                    ${reviews ? `<span class="guide-stat guide-stat--reviews"><i class="fas fa-comment" aria-hidden="true"></i> ${reviews}</span>` : ''}
                    ${dist ? `<span class="guide-stat guide-stat--dist"><i class="fas fa-route" aria-hidden="true"></i> ${esc(dist)}</span>` : ''}
                </div>
                <p class="guide-card-addr">${esc(item.address || item.desc || '暂无地址')}</p>
                <div class="guide-card-tags">
                    ${item.campus ? `<span class="guide-tag guide-tag--campus"><i class="fas fa-location-dot" aria-hidden="true"></i> ${esc(item.campus)}</span>` : ''}
                    ${item.type ? `<span class="guide-tag guide-tag--type">${esc(item.type)}</span>` : ''}
                </div>
                <button type="button" class="guide-card-like-btn ${item.liked ? 'is-liked' : ''}" data-like-idx="${idx}" aria-label="点赞">
                    <i class="fas fa-heart" aria-hidden="true"></i>
                    <span>${item.liked ? '已点赞' : '点赞支持'}</span>
                </button>
            </div>
        </article>`;
}

function sectionHtml(title, items, offset = 0) {
    const cards = items.map((item, i) => cardHtml(item, offset + i)).join('');
    return `<section class="guide-campus-section"><h3 class="guide-section-title">${esc(title)}</h3><div class="guide-waterfall guide-section-waterfall">${cards}</div></section>`;
}

/** 从缓存同步绘制（支持单校区 items 与「全部」sections） */
export function paintGuideGridFromCache(container, key) {
    if (!container || !key) return false;
    const data = readWarmLeaderboard(key);
    if (!data) return false;

    let html = '';
    if (data.sections?.length) {
        let offset = 0;
        const cat = data.category || '';
        for (const section of data.sections) {
            const items = section.items || [];
            if (!items.length) continue;
            html += sectionHtml(`${section.campus} · ${cat}`, items, offset);
            offset += items.length;
        }
    } else if (data.items?.length) {
        html = data.items.map((item, idx) => cardHtml(item, idx)).join('');
    } else {
        return false;
    }

    container.innerHTML = html;
    container.dataset.guideKey = key;
    return true;
}

/** 在 guide.js 加载前同步绘制首屏（默认鼓楼·美食） */
export function paintGuideEntryGrid(container, key = entryCacheKey()) {
    return paintGuideGridFromCache(container, key);
}

export function hydrateMemoryLeaderboardCache(target, key = entryCacheKey()) {
    const data = readWarmLeaderboard(key);
    if (!data) return null;
    target[key] = data;
    return data;
}
