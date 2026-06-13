/**
 * 吃喝玩乐点赞：前端即时反馈，延迟批量同步数据库。
 * 已赞状态写入 localStorage + /me/likes，刷新后仍能恢复红心。
 */
import {
    getAuthToken,
    getGuideLikeKey,
    getLikes,
    resolveGuidePlaceId,
    syncGuideLikeToServer,
} from './api.js';

const SYNC_DELAY_MS = 2000;
const MAX_SYNC_RETRIES = 3;
const SYNC_STORAGE_PREFIX = 'njuatlas_guide_like_sync_v1';
const SYNC_OWNER_KEY = 'njuatlas_guide_like_sync_owner_v1';
const USER_LIKES_TTL_MS = 60 * 1000;

const _syncedState = new Map();
const _pending = new Map();
const _userLikedPlaceIds = new Set();
const _userLikedPoiIds = new Set();
const _userLikedNameKeys = new Set();
let _flushTimer = null;
let _flushPromise = null;
let _userLikesFetchedAt = 0;

function _nameAddrKey(name, address = '') {
    const n = (name || '').trim().toLowerCase();
    const a = (address || '').trim().toLowerCase();
    return n ? `${n}|${a}` : '';
}

function _currentUserId() {
    try {
        const user = JSON.parse(localStorage.getItem('current_user') || 'null');
        return user?.id != null ? String(user.id) : null;
    } catch {
        return null;
    }
}

function _syncStorageKey(userId = _currentUserId()) {
    return userId ? `${SYNC_STORAGE_PREFIX}_${userId}` : `${SYNC_STORAGE_PREFIX}_guest`;
}

function _loadSyncedStateFromStorage() {
    const uid = _currentUserId();
    if (!uid) return;
    const owner = localStorage.getItem(SYNC_OWNER_KEY);
    if (owner && owner !== uid) return;
    try {
        const raw = localStorage.getItem(_syncStorageKey(uid));
        if (!raw) return;
        for (const [key, value] of JSON.parse(raw)) {
            if (value?.liked) _syncedState.set(key, value);
        }
    } catch { /* ignore */ }
}

function _persistSyncedState() {
    const uid = _currentUserId();
    if (!uid) return;
    try {
        const likedOnly = [..._syncedState.entries()].filter(([, v]) => v?.liked);
        localStorage.setItem(SYNC_OWNER_KEY, uid);
        localStorage.setItem(_syncStorageKey(uid), JSON.stringify(likedOnly));
        localStorage.removeItem(`${SYNC_STORAGE_PREFIX}_guest`);
        localStorage.removeItem(SYNC_STORAGE_PREFIX);
    } catch { /* ignore */ }
}

/** 登出 / 换号时清空本机点赞同步状态，避免串号 */
export function resetGuideLikeSync() {
    _syncedState.clear();
    _pending.clear();
    _userLikedPlaceIds.clear();
    _userLikedPoiIds.clear();
    _userLikedNameKeys.clear();
    _userLikesFetchedAt = 0;
    if (_flushTimer) {
        clearTimeout(_flushTimer);
        _flushTimer = null;
    }
    try {
        localStorage.removeItem(SYNC_OWNER_KEY);
        localStorage.removeItem(SYNC_STORAGE_PREFIX);
        localStorage.removeItem(`${SYNC_STORAGE_PREFIX}_guest`);
    } catch { /* ignore */ }
}

_loadSyncedStateFromStorage();

function _rememberSynced(key, synced) {
    if (synced.liked) {
        _syncedState.set(key, synced);
    } else {
        _syncedState.delete(key);
    }
    _persistSyncedState();
}

function _baseline(key, item) {
    if (!_syncedState.has(key)) {
        _syncedState.set(key, {
            liked: Boolean(item.liked),
            likes: Number(item.like_count || 0),
            place_id: item.place_id || resolveGuidePlaceId(item) || null,
        });
    }
    return _syncedState.get(key);
}

function _itemMatchesUserLikes(item) {
    const placeId = item.place_id || resolveGuidePlaceId(item);
    if (placeId && _userLikedPlaceIds.has(Number(placeId))) return true;
    const poiId = item.poi_id ? String(item.poi_id).trim() : '';
    if (poiId && _userLikedPoiIds.has(poiId)) return true;
    const nameKey = _nameAddrKey(item.name, item.address);
    return nameKey && _userLikedNameKeys.has(nameKey);
}

/** 从 /me/likes 拉取当前用户已赞店铺（刷新后恢复红心） */
export async function refreshUserGuideLikes({ force = false } = {}) {
    if (!getAuthToken()) return;
    if (!force && _userLikesFetchedAt && Date.now() - _userLikesFetchedAt < USER_LIKES_TTL_MS) {
        return;
    }
    try {
        const data = await getLikes();
        _userLikedPlaceIds.clear();
        _userLikedPoiIds.clear();
        _userLikedNameKeys.clear();
        for (const row of data.items || []) {
            const place = row.place;
            if (!place) continue;
            if (place.id != null) _userLikedPlaceIds.add(Number(place.id));
            if (place.poi_id) _userLikedPoiIds.add(String(place.poi_id).trim());
            const nameKey = _nameAddrKey(place.name, place.address);
            if (nameKey) _userLikedNameKeys.add(nameKey);
            const stub = {
                poi_id: place.poi_id,
                name: place.name,
                address: place.address,
                place_id: place.id,
            };
            const key = getGuideLikeKey(stub);
            _rememberSynced(key, {
                liked: true,
                likes: _syncedState.get(key)?.likes ?? 1,
                place_id: place.id,
            });
        }
        _userLikesFetchedAt = Date.now();
    } catch {
        _userLikesFetchedAt = 0;
    }
}

/** 排行榜/搜索渲染后合并服务端数据（不覆盖 pending 项） */
export function seedGuideLikeSyncFromItems(items) {
    if (!items?.length || !getAuthToken()) return;
    for (const item of items) {
        const key = getGuideLikeKey(item);
        if (_pending.has(key)) continue;
        const prev = _syncedState.get(key);
        const serverLiked = _itemMatchesUserLikes(item);
        const serverLikes = Number(item.like_count || 0);
        const placeId = item.place_id || resolveGuidePlaceId(item) || prev?.place_id || null;
        if (!prev) {
            _rememberSynced(key, { liked: serverLiked, likes: serverLikes, place_id: placeId });
            continue;
        }
        _rememberSynced(key, {
            liked: serverLiked || prev.liked,
            likes: Math.max(serverLikes, prev.likes),
            place_id: placeId || prev.place_id,
        });
    }
}

/** 用本地已同步/待同步状态覆盖列表项 */
export function overlayGuideLikeStateOnItems(items) {
    if (!items?.length) return items;
    if (!getAuthToken()) {
        for (const item of items) item.liked = false;
        return items;
    }
    for (const item of items) {
        const key = getGuideLikeKey(item);
        const pending = _pending.get(key);
        const synced = _syncedState.get(key);
        const userLiked = _itemMatchesUserLikes(item);

        if (pending) {
            item.liked = pending.targetLiked;
            const baseLikes = synced?.likes ?? Number(item.like_count || 0);
            const baseLiked = synced?.liked ?? userLiked;
            if (pending.targetLiked && !baseLiked) {
                item.like_count = Math.max(baseLikes + 1, Number(item.like_count || 0));
            } else if (!pending.targetLiked && baseLiked) {
                item.like_count = Math.max(0, baseLikes - 1);
            } else {
                item.like_count = baseLikes;
            }
            if (synced?.place_id) item.place_id = synced.place_id;
            continue;
        }

        if (synced?.liked || userLiked) {
            item.liked = true;
            item.like_count = Math.max(
                Number(item.like_count || 0),
                synced?.likes ?? 0,
                userLiked ? 1 : 0,
            );
            if (synced?.place_id) item.place_id = synced.place_id;
        } else if (synced) {
            item.liked = synced.liked;
            item.like_count = synced.likes;
            if (synced.place_id) item.place_id = synced.place_id;
        }
    }
    return items;
}

export function queueGuideLikeChange({
    key,
    campus,
    category,
    item,
    targetLiked,
    onSynced,
    onReverted,
    onError,
}) {
    const synced = _baseline(key, item);

    if (targetLiked === synced.liked) {
        _pending.delete(key);
        onReverted?.(synced);
        return;
    }

    _pending.set(key, {
        key,
        campus,
        category,
        item,
        targetLiked,
        retries: 0,
        onSynced,
        onReverted,
        onError,
    });
    _scheduleFlush();
}

function _scheduleFlush() {
    if (_flushTimer) clearTimeout(_flushTimer);
    _flushTimer = setTimeout(() => {
        _flushTimer = null;
        flushGuideLikeQueue();
    }, SYNC_DELAY_MS);
}

async function _runFlushPass() {
    if (_flushTimer) {
        clearTimeout(_flushTimer);
        _flushTimer = null;
    }

    const entries = [..._pending.values()];
    for (const entry of entries) {
        if (!_pending.has(entry.key)) continue;
        try {
            const result = await syncGuideLikeToServer({
                campus: entry.campus,
                category: entry.category,
                item: entry.item,
                liked: entry.targetLiked,
            });
            const prev = _syncedState.get(entry.key) || {};
            const synced = {
                liked: Boolean(result.liked),
                likes: result.likes != null ? Number(result.likes) : prev.likes ?? 0,
                place_id: result.place_id ?? entry.item.place_id ?? prev.place_id ?? null,
            };
            _rememberSynced(entry.key, synced);
            if (synced.liked) {
                if (synced.place_id) _userLikedPlaceIds.add(Number(synced.place_id));
                if (entry.item.poi_id) _userLikedPoiIds.add(String(entry.item.poi_id).trim());
                const nameKey = _nameAddrKey(entry.item.name, entry.item.address);
                if (nameKey) _userLikedNameKeys.add(nameKey);
            } else {
                if (synced.place_id) _userLikedPlaceIds.delete(Number(synced.place_id));
                if (entry.item.poi_id) _userLikedPoiIds.delete(String(entry.item.poi_id).trim());
                const nameKey = _nameAddrKey(entry.item.name, entry.item.address);
                if (nameKey) _userLikedNameKeys.delete(nameKey);
            }
            _pending.delete(entry.key);
            entry.onSynced?.(result, synced);
        } catch (err) {
            entry.retries = (entry.retries || 0) + 1;
            if (entry.retries >= MAX_SYNC_RETRIES) {
                _pending.delete(entry.key);
                entry.onReverted?.(_syncedState.get(entry.key));
                entry.onError?.(err);
            }
        }
    }
}

/** 立即将 pending 点赞写入数据库；并发调用会排队等待 */
export function flushGuideLikeQueue() {
    if (_flushPromise) return _flushPromise;

    _flushPromise = (async () => {
        let rounds = 0;
        while (_pending.size > 0 && rounds < MAX_SYNC_RETRIES + 2) {
            await _runFlushPass();
            if (_pending.size > 0) {
                await new Promise((r) => setTimeout(r, 600));
            }
            rounds += 1;
        }
    })().finally(() => {
        _flushPromise = null;
        if (_pending.size > 0) _scheduleFlush();
    });

    return _flushPromise;
}

export function hasPendingGuideLikes() {
    return _pending.size > 0;
}

if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushGuideLikeQueue();
    });
    window.addEventListener('pagehide', () => flushGuideLikeQueue());
    window.addEventListener('njuatlas:auth-change', () => {
        if (!getAuthToken()) resetGuideLikeSync();
    });
}
