import { getUser } from '../../auth.js';
import {
    partnerListCache,
    partnerListCacheKey,
    partnerStore,
    LIST_CACHE_TTL_MS,
    FULL_LIST_CACHE_TTL_MS,
    DEFAULT_URGENCY_SCOPE,
} from './shared.js';

export const PARTNER_SESSION_CACHE_PREFIX = 'partner_list_v2_';

export function isPartnerListCacheFresh(entry) {
    if (!entry?.at) return false;
    const ttl = entry.fullyLoaded ? FULL_LIST_CACHE_TTL_MS : LIST_CACHE_TTL_MS;
    return Date.now() - entry.at < ttl;
}

function _persistSessionCache(key, entry) {
    try {
        sessionStorage.setItem(PARTNER_SESSION_CACHE_PREFIX + key, JSON.stringify(entry));
    } catch { /* quota or private mode */ }
}

function _hydrateSessionCache(key) {
    try {
        const raw = sessionStorage.getItem(PARTNER_SESSION_CACHE_PREFIX + key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function readPartnerListCache(category, searchQuery, page) {
    const key = partnerListCacheKey(category, searchQuery, page);
    let cached = partnerListCache.get(key);
    if (!cached) {
        cached = _hydrateSessionCache(key);
        if (cached) partnerListCache.set(key, cached);
    }
    return cached;
}

export function writePartnerListCache(category, searchQuery, page, posts, hasMore) {
    const key = partnerListCacheKey(category, searchQuery, page);
    const entry = {
        at: Date.now(),
        posts,
        hasMore,
        page,
        fullyLoaded: !hasMore,
    };
    partnerListCache.set(key, entry);
    _persistSessionCache(key, entry);
    return entry;
}

export function clearPartnerListCache() {
    partnerListCache.clear();
    partnerStore._prefetchPromise = null;
    try {
        const prefix = PARTNER_SESSION_CACHE_PREFIX;
        const keys = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key && key.startsWith(prefix)) keys.push(key);
        }
        keys.forEach((key) => sessionStorage.removeItem(key));
    } catch { /* quota or private mode */ }
}

/** 收集当前 scope 下各分类第 1 页缓存中的帖子 id（供详情预取 Stage 2 使用） */
export function collectCachedListPostIds({ urgencyScope, searchQuery = '' } = {}) {
    const scope = urgencyScope || partnerStore.urgencyScope || DEFAULT_URGENCY_SCOPE;
    const user = getUser();
    const userKey = user?.id ?? user?.user_id ?? 'anon';
    const prefix = `${userKey}|nearby|`;
    const suffix = `|${searchQuery}|${scope}|1`;
    const ids = new Set();

    for (const key of partnerListCache.keys()) {
        if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
        const row = partnerListCache.get(key);
        for (const post of row?.posts || []) {
            if (post?.id > 0) ids.add(post.id);
        }
    }

    try {
        for (let i = 0; i < sessionStorage.length; i++) {
            const storageKey = sessionStorage.key(i);
            if (!storageKey?.startsWith(PARTNER_SESSION_CACHE_PREFIX)) continue;
            const cacheKey = storageKey.slice(PARTNER_SESSION_CACHE_PREFIX.length);
            if (!cacheKey.startsWith(prefix) || !cacheKey.endsWith(suffix)) continue;
            const row = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
            for (const post of row?.posts || []) {
                if (post?.id > 0) ids.add(post.id);
            }
        }
    } catch { /* ignore */ }

    return [...ids];
}
