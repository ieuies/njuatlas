/**
 * 消息系统登录后预加载：三 Tab 列表 + Top N 未读会话 tail
 */
import {
    getAuthToken,
    getInboxBootstrap,
    listFriendsBundle,
    listNotifications,
    getDmMessages,
} from './api.js';

export const MSG_CACHE_TTL_MS = 30000;
export const SESSION_CONV_KEY = 'njuatlas_msg_conv_v1';
export const SESSION_FRIENDS_KEY = 'njuatlas_msg_friends_v1';
export const SESSION_INTERACT_KEY = 'njuatlas_msg_interact_v1';
export const SESSION_THREADS_KEY = 'njuatlas_msg_threads_v1';

const THREAD_PREFETCH_MAX = 5;
const THREAD_PREFETCH_GAP_MS = 300;
const CHAT_PAGE_SIZE = 50;

/** @type {Promise<unknown> | null} */
let _prefetchPromise = null;

function isCacheFresh(at) {
    return at && (Date.now() - at) < MSG_CACHE_TTL_MS;
}

function _readSessionRow(key) {
    try {
        const row = JSON.parse(sessionStorage.getItem(key) || 'null');
        if (!row || !isCacheFresh(row.at)) return null;
        return row;
    } catch {
        return null;
    }
}

function _writeSessionRow(key, payload) {
    try {
        sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), ...payload }));
    } catch { /* quota */ }
}

export function persistSessionChats(items) {
    _writeSessionRow(SESSION_CONV_KEY, { items: items || [] });
}

export function persistSessionFriends({ friends, requests, sent } = {}) {
    _writeSessionRow(SESSION_FRIENDS_KEY, {
        friends: friends || [],
        requests: requests || [],
        sent: sent || [],
    });
}

export function persistSessionInteract(items) {
    _writeSessionRow(SESSION_INTERACT_KEY, { items: items || [] });
}

export function readSessionChats() {
    const row = _readSessionRow(SESSION_CONV_KEY);
    return row?.items || null;
}

export function readSessionFriends() {
    const row = _readSessionRow(SESSION_FRIENDS_KEY);
    if (!row) return null;
    return {
        friends: row.friends || [],
        requests: row.requests || [],
        sent: row.sent || [],
    };
}

export function readSessionInteract() {
    const row = _readSessionRow(SESSION_INTERACT_KEY);
    return row?.items || null;
}

function _readThreadsStore() {
    const row = _readSessionRow(SESSION_THREADS_KEY);
    return row?.threads && typeof row.threads === 'object' ? row.threads : {};
}

function _writeThreadsStore(threads) {
    _writeSessionRow(SESSION_THREADS_KEY, { threads });
}

export function getCachedDmThread(peerId) {
    const id = Number(peerId);
    if (!id) return null;
    const threads = _readThreadsStore();
    const row = threads[String(id)];
    if (!row?.messages || !isCacheFresh(row.at)) return null;
    return {
        peer: row.peer || { id },
        messages: row.messages,
        hasMoreOlder: Boolean(row.hasMoreOlder),
    };
}

export function setCachedDmThread(peerId, { peer, messages, hasMoreOlder } = {}) {
    const id = Number(peerId);
    if (!id || !Array.isArray(messages)) return;
    const threads = _readThreadsStore();
    threads[String(id)] = {
        at: Date.now(),
        peer: peer || { id },
        messages,
        hasMoreOlder: Boolean(hasMoreOlder),
    };
    _writeThreadsStore(threads);
}

export function invalidateDmThread(peerId) {
    const id = Number(peerId);
    if (!id) return;
    const threads = _readThreadsStore();
    if (!threads[String(id)]) return;
    delete threads[String(id)];
    _writeThreadsStore(threads);
}

export function invalidateMessagesChatsCache() {
    try { sessionStorage.removeItem(SESSION_CONV_KEY); } catch { /* ignore */ }
}

export function invalidateMessagesFriendsCache() {
    try { sessionStorage.removeItem(SESSION_FRIENDS_KEY); } catch { /* ignore */ }
}

export function invalidateMessagesInteractCache() {
    try { sessionStorage.removeItem(SESSION_INTERACT_KEY); } catch { /* ignore */ }
}

export function clearMessagesPrefetchCache() {
    invalidateMessagesChatsCache();
    invalidateMessagesFriendsCache();
    invalidateMessagesInteractCache();
    try { sessionStorage.removeItem(SESSION_THREADS_KEY); } catch { /* ignore */ }
    _prefetchPromise = null;
    _listsInflight = null;
}

function _persistBootstrap(bootstrap) {
    const items = bootstrap?.conversations?.items || [];
    persistSessionChats(items);
    return items;
}

function _persistFriendsBundle(bundle) {
    persistSessionFriends({
        friends: bundle?.friends || [],
        requests: bundle?.requests || [],
        sent: bundle?.sent || [],
    });
}

function _persistNotifications(data) {
    persistSessionInteract(data?.items || []);
}

function _pickUnreadPeerIds(conversations) {
    return [...(conversations || [])]
        .filter((c) => Number(c.unread_count) > 0 && Number(c.peer_id) > 0)
        .sort((a, b) => {
            const unreadDiff = Number(b.unread_count || 0) - Number(a.unread_count || 0);
            if (unreadDiff !== 0) return unreadDiff;
            const ta = new Date(a.last_at || 0).getTime();
            const tb = new Date(b.last_at || 0).getTime();
            return tb - ta;
        })
        .slice(0, THREAD_PREFETCH_MAX)
        .map((c) => Number(c.peer_id));
}

async function _prefetchDmThreads(peerIds, { force = false } = {}) {
    for (const peerId of peerIds) {
        if (!force && getCachedDmThread(peerId)) {
            if (THREAD_PREFETCH_GAP_MS > 0) {
                await new Promise((r) => setTimeout(r, THREAD_PREFETCH_GAP_MS));
            }
            continue;
        }
        try {
            const data = await getDmMessages(peerId, { tail: true, page_size: CHAT_PAGE_SIZE }, true);
            setCachedDmThread(peerId, {
                peer: data.peer || { id: peerId },
                messages: data.items || [],
                hasMoreOlder: Boolean(data.has_more),
            });
        } catch { /* ignore */ }
        if (THREAD_PREFETCH_GAP_MS > 0) {
            await new Promise((r) => setTimeout(r, THREAD_PREFETCH_GAP_MS));
        }
    }
}

let _listsInflight = null;

export async function prefetchMessagesLists({ force = false } = {}) {
    if (!getAuthToken()) return null;

    const listsFresh = !force
        && readSessionChats()
        && readSessionFriends()
        && readSessionInteract();

    if (listsFresh) {
        return {
            conversations: { items: readSessionChats() },
            unread: null,
            fromCache: true,
        };
    }

    if (_listsInflight && !force) {
        return _listsInflight;
    }

    _listsInflight = Promise.all([
        getInboxBootstrap(),
        listFriendsBundle(),
        listNotifications({ page: 1, page_size: 30 }),
    ])
        .then(([bootstrap, friendsBundle, notifications]) => {
            _persistBootstrap(bootstrap);
            _persistFriendsBundle(friendsBundle);
            _persistNotifications(notifications);
            if (typeof window.refreshUnreadBadge === 'function') {
                window.refreshUnreadBadge(bootstrap?.unread, { force: true });
            }
            return bootstrap;
        })
        .finally(() => {
            _listsInflight = null;
        });

    return _listsInflight;
}

export async function prefetchMessagesSystem({ force = false, listsOnly = false } = {}) {
    if (!getAuthToken()) return { skipped: true, reason: 'not_logged_in' };

    const bootstrap = await prefetchMessagesLists({ force });
    const conversations = bootstrap?.conversations?.items || readSessionChats() || [];

    if (!listsOnly) {
        const peerIds = _pickUnreadPeerIds(conversations);
        await _prefetchDmThreads(peerIds, { force });
        return { skipped: false, listsOnly: false, threadCount: peerIds.length };
    }

    return { skipped: false, listsOnly: true, threadCount: 0 };
}

function _scheduleThreadPrefetch(conversations, options = {}) {
    const peerIds = _pickUnreadPeerIds(conversations);
    if (!peerIds.length) return;
    const run = () => {
        _prefetchDmThreads(peerIds, options).catch(() => {});
    };
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run, { timeout: 3000 });
    } else {
        setTimeout(run, 500);
    }
}

/** 登录后预取：列表立即拉取，未读会话 tail 空闲时串行预取（与 prefetchMessagesEntryData 共用列表单飞） */
export function scheduleMessagesPrefetch(options = {}) {
    prefetchMessagesLists(options)
        .then((bootstrap) => {
            const conversations = bootstrap?.conversations?.items || readSessionChats() || [];
            if (!options.listsOnly) {
                _scheduleThreadPrefetch(conversations, options);
            }
        })
        .catch(() => {});
}

/** 兼容旧入口：悬停消息 Tab / 冷启动 / 打开消息页补拉 */
export function prefetchMessagesEntryData(options = {}) {
    if (!getAuthToken()) return Promise.resolve();
    if (_prefetchPromise) return _prefetchPromise;
    _prefetchPromise = prefetchMessagesSystem(options)
        .catch(() => ({}))
        .finally(() => {
            _prefetchPromise = null;
        });
    return _prefetchPromise;
}
