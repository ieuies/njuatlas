/**
 * 找搭子预加载管道
 *
 * Stage 1（已实现）：各分类列表第 1 页串行预取 → 切换分类秒开
 * Stage 2（预留）：帖子详情预取 → 见 prefetchPartnerPostDetails / partnerPostDetailCache
 */
import { listPosts } from '../../api.js';
import {
    mapPost,
    PAGE_SIZE,
    PARTNER_FILTER_CATEGORIES,
    partnerStore,
} from './shared.js';
import {
    collectCachedListPostIds,
    isPartnerListCacheFresh,
    readPartnerListCache,
    writePartnerListCache,
} from './list-cache.js';

const PREFETCH_GAP_MS = 320;
const PREFETCH_429_BASE_MS = 2000;
const PREFETCH_MAX_ATTEMPTS = 4;

// ── Stage 2: 帖子详情缓存（后续实现详情预取时写入）────────────────
export const partnerPostDetailCache = new Map();
/** @type {Promise<unknown> | null} */
let _detailPrefetchPromise = null;

export function getCachedPartnerPostDetail(postId) {
    const row = partnerPostDetailCache.get(Number(postId));
    if (!row?.data) return null;
    return row.data;
}

export function setCachedPartnerPostDetail(postId, data) {
    if (!postId || !data) return;
    partnerPostDetailCache.set(Number(postId), { at: Date.now(), data });
}

export function invalidatePartnerPostDetailCache(postIds = null) {
    if (!postIds) {
        partnerPostDetailCache.clear();
        _detailPrefetchPromise = null;
        return;
    }
    for (const id of postIds) {
        partnerPostDetailCache.delete(Number(id));
    }
}

/**
 * Stage 2 入口：根据已缓存列表批量预取帖子详情。
 * 当前为占位实现，列表预取完成后会调用；后续在此串行 getPost 并写入 partnerPostDetailCache。
 */
export async function prefetchPartnerPostDetails({ postIds, urgencyScope } = {}) {
    const ids = postIds?.length
        ? postIds.filter((id) => id > 0)
        : collectCachedListPostIds({ urgencyScope });

    if (!ids.length) {
        return { prefetched: 0, skipped: 0, total: 0, stage: 2, implemented: false };
    }

    // TODO(stage-2): import { getPost } from '../../api.js'
    // TODO(stage-2): for (const id of ids) { if (getCachedPartnerPostDetail(id)) continue; ... }
    void urgencyScope;
    return {
        prefetched: 0,
        skipped: ids.length,
        total: ids.length,
        stage: 2,
        implemented: false,
    };
}

function _isRateLimitError(err) {
    const msg = String(err?.message || '');
    return msg.includes('过于频繁') || msg.includes('429');
}

function _listPartnerPrefetchCategories() {
    return PARTNER_FILTER_CATEGORIES.map((item) => item.category);
}

async function _fetchOneCategoryPage(category, urgencyScope) {
    const searchQuery = '';
    const cached = readPartnerListCache(category, searchQuery, 1);
    if (cached?.posts && isPartnerListCacheFresh(cached)) {
        return { category, skipped: true };
    }

    const params = {
        page: 1,
        page_size: PAGE_SIZE,
        sort: 'nearby',
        urgency_scope: urgencyScope,
    };
    if (category !== 'all') {
        params.tags = category;
    }

    for (let attempt = 0; attempt < PREFETCH_MAX_ATTEMPTS; attempt += 1) {
        try {
            const result = await listPosts(params);
            let posts = (result.items || []).map(mapPost);
            if (category !== 'all') {
                posts = posts.filter((post) => post.tags.includes(category));
            }
            writePartnerListCache(category, searchQuery, 1, posts, posts.length === PAGE_SIZE);
            return { category, skipped: false, count: posts.length };
        } catch (err) {
            if (_isRateLimitError(err) && attempt < PREFETCH_MAX_ATTEMPTS - 1) {
                const delay = PREFETCH_429_BASE_MS * (2 ** attempt);
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            return { category, error: err };
        }
    }
    return { category, error: new Error('prefetch exhausted') };
}

async function _runListPrefetchPipeline({ urgencyScope } = {}) {
    const scope = urgencyScope || partnerStore.urgencyScope || 'short';
    if ((partnerStore.searchQuery || '').trim()) {
        return { stage: 1, skipped: true, reason: 'search_active' };
    }

    const categories = _listPartnerPrefetchCategories();
    const results = [];

    for (const category of categories) {
        results.push(await _fetchOneCategoryPage(category, scope));
        if (PREFETCH_GAP_MS > 0) {
            await new Promise((r) => setTimeout(r, PREFETCH_GAP_MS));
        }
    }

    // Stage 2 hook: 列表预取结束后，可在此触发详情预取（当前为占位）
    if (!_detailPrefetchPromise) {
        _detailPrefetchPromise = prefetchPartnerPostDetails({ urgencyScope: scope })
            .catch(() => {})
            .finally(() => {
                _detailPrefetchPromise = null;
            });
    }

    return { stage: 1, results };
}

/** 串行预取全部分类第 1 页（同 scope、无搜索词时） */
export function prefetchAllPartnerCategories(options = {}) {
    if (partnerStore._prefetchPromise) return partnerStore._prefetchPromise;

    partnerStore._prefetchPromise = _runListPrefetchPipeline(options)
        .catch(() => ({ stage: 1, failed: true }))
        .finally(() => {
            partnerStore._prefetchPromise = null;
        });

    return partnerStore._prefetchPromise;
}

/** 兼容旧入口：悬停 Tab / 冷启动意图预取 */
export function prefetchPartnerList() {
    return prefetchAllPartnerCategories();
}

/** 首屏加载后空闲触发，不阻塞 UI */
export function schedulePartnerPrefetch(options = {}) {
    const run = () => {
        prefetchAllPartnerCategories(options).catch(() => {});
    };
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run, { timeout: 2500 });
    } else {
        setTimeout(run, 300);
    }
}
