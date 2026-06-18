/**
 * 找搭子预加载管道
 *
 * Stage 1：各分类列表第 1 页串行预取 → 切换分类秒开
 * Stage 2：帖子详情预取 → openPostDetail 优先读 partnerPostDetailCache
 */
import { getUser } from '../../auth.js';
import { getPost, listPosts } from '../../api.js';
import {
    LIST_CACHE_TTL_MS,
    mapPost,
    PAGE_SIZE,
    PARTNER_FILTER_CATEGORIES,
    partnerStore,
    DEFAULT_URGENCY_SCOPE,
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

const DETAIL_CACHE_TTL_MS = LIST_CACHE_TTL_MS;
const DETAIL_PREFETCH_GAP_MS = 320;
const DETAIL_PREFETCH_MAX = 60;

// ── Stage 2: 帖子详情缓存 ────────────────────────────────────────
export const partnerPostDetailCache = new Map();
const _detailPrefetchPending = new Set();
/** @type {Promise<void> | null} */
let _detailPrefetchWorker = null;

function _detailUserKey() {
    const user = getUser();
    return user?.id ?? user?.user_id ?? 'anon';
}

function _detailCacheKey(postId) {
    return `${_detailUserKey()}|${Number(postId)}`;
}

function _getCacheRow(postId) {
    return partnerPostDetailCache.get(_detailCacheKey(postId));
}

export function isPartnerPostDetailCacheFresh(postId) {
    const row = _getCacheRow(postId);
    if (!row?.data || !row.at) return false;
    return Date.now() - row.at < DETAIL_CACHE_TTL_MS;
}

export function getCachedPartnerPostDetail(postId) {
    if (!isPartnerPostDetailCacheFresh(postId)) return null;
    return _getCacheRow(postId).data;
}

export function setCachedPartnerPostDetail(postId, data) {
    if (!postId || !data) return;
    partnerPostDetailCache.set(_detailCacheKey(postId), {
        at: Date.now(),
        data,
        userKey: _detailUserKey(),
    });
}

export function invalidatePartnerPostDetailCache(postIds = null) {
    if (!postIds) {
        partnerPostDetailCache.clear();
        _detailPrefetchPending.clear();
        _detailPrefetchWorker = null;
        return;
    }
    for (const id of postIds) {
        partnerPostDetailCache.delete(_detailCacheKey(id));
    }
}

/**
 * 将帖子 id 加入详情预取队列（首屏列表加载后即可调用，不必等 Stage 1 结束）。
 * @param {number[]} postIds
 * @param {{ priority?: boolean }} options priority=true 时插队到队列前端
 */
export function enqueuePartnerDetailPrefetch(postIds = [], { priority = false } = {}) {
    const normalized = postIds
        .map((id) => Number(id))
        .filter((id) => id > 0 && !isPartnerPostDetailCacheFresh(id));

    if (!normalized.length) return;

    if (priority) {
        const rest = [..._detailPrefetchPending];
        _detailPrefetchPending.clear();
        for (const id of normalized) _detailPrefetchPending.add(id);
        for (const id of rest) _detailPrefetchPending.add(id);
    } else {
        for (const id of normalized) _detailPrefetchPending.add(id);
    }

    if (!_detailPrefetchWorker) {
        _detailPrefetchWorker = _runDetailPrefetchWorker()
            .catch(() => {})
            .finally(() => {
                _detailPrefetchWorker = null;
                if (_detailPrefetchPending.size > 0) {
                    enqueuePartnerDetailPrefetch([..._detailPrefetchPending]);
                }
            });
    }
}

async function _fetchOnePostDetail(postId) {
    for (let attempt = 0; attempt < PREFETCH_MAX_ATTEMPTS; attempt += 1) {
        try {
            const data = await getPost(postId, { prefetch: true, silent: true });
            setCachedPartnerPostDetail(postId, data);
            return true;
        } catch (err) {
            if (_isRateLimitError(err) && attempt < PREFETCH_MAX_ATTEMPTS - 1) {
                const delay = PREFETCH_429_BASE_MS * (2 ** attempt);
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            return false;
        }
    }
    return false;
}

async function _runDetailPrefetchWorker() {
    let fetched = 0;
    while (_detailPrefetchPending.size > 0 && fetched < DETAIL_PREFETCH_MAX) {
        const id = _detailPrefetchPending.values().next().value;
        _detailPrefetchPending.delete(id);

        if (isPartnerPostDetailCacheFresh(id)) continue;

        await _fetchOnePostDetail(id);
        fetched += 1;

        if (_detailPrefetchPending.size > 0 && DETAIL_PREFETCH_GAP_MS > 0) {
            await new Promise((r) => setTimeout(r, DETAIL_PREFETCH_GAP_MS));
        }
    }
}

/**
 * Stage 2：根据已缓存列表批量预取帖子详情（串行、不计浏览量）。
 */
export async function prefetchPartnerPostDetails({ postIds, urgencyScope } = {}) {
    let ids = postIds?.length
        ? postIds.filter((id) => id > 0)
        : collectCachedListPostIds({ urgencyScope });

    if (!ids.length) {
        return { prefetched: 0, skipped: 0, total: 0, stage: 2, implemented: true };
    }

    ids = ids.slice(0, DETAIL_PREFETCH_MAX);
    const needFetch = ids.filter((id) => !isPartnerPostDetailCacheFresh(id));
    const skipped = ids.length - needFetch.length;

    enqueuePartnerDetailPrefetch(needFetch);

    if (_detailPrefetchWorker) {
        await _detailPrefetchWorker.catch(() => {});
    }

    const prefetched = needFetch.filter((id) => isPartnerPostDetailCacheFresh(id)).length;
    return { prefetched, skipped, total: ids.length, stage: 2, implemented: true };
}

function _isRateLimitError(err) {
    const msg = String(err?.message || '');
    return msg.includes('过于频繁') || msg.includes('429');
}

function _listPartnerPrefetchCategories() {
    return PARTNER_FILTER_CATEGORIES.map((item) => item.category);
}

function _enqueueDetailPrefetchFromListCache(urgencyScope) {
    const ids = collectCachedListPostIds({ urgencyScope });
    if (ids.length) enqueuePartnerDetailPrefetch(ids);
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
    const scope = urgencyScope || partnerStore.urgencyScope || DEFAULT_URGENCY_SCOPE;
    if ((partnerStore.searchQuery || '').trim()) {
        return { stage: 1, skipped: true, reason: 'search_active' };
    }

    // 首屏列表已在 loadPostsByPage 写入缓存，立即启动详情预取，不必等全部分类列表跑完
    _enqueueDetailPrefetchFromListCache(scope);

    const categories = _listPartnerPrefetchCategories();
    const results = [];

    for (const category of categories) {
        results.push(await _fetchOneCategoryPage(category, scope));
        _enqueueDetailPrefetchFromListCache(scope);
        if (PREFETCH_GAP_MS > 0) {
            await new Promise((r) => setTimeout(r, PREFETCH_GAP_MS));
        }
    }

    await prefetchPartnerPostDetails({ urgencyScope: scope });

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
