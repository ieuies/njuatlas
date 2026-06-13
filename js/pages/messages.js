/**
 * 消息中心：私信 + 好友 + 互动通知
 * 优化：Tab 缓存、聊天增量渲染、乐观发送、好友页局部刷新
 */
import { getUser } from '../auth.js';
import {
    listDmConversations,
    getInboxBootstrap,
    getDmMessages,
    sendDmMessage,
    listFriends,
    listFriendsBundle,
    listFriendRequests,
    listSentFriendRequests,
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    cancelFriendRequest,
    removeFriend,
    searchUsers,
    listNotifications,
    markNotificationsRead,
    getUnreadCounts,
    invalidateUnreadCache,
    markDmThreadRead,
    getAuthToken,
} from '../api.js';
import { API_BASE } from '../config.js';
import { showToast, escapeHtml, avatarHtmlForUser, formatTimeBrief, formatChatDividerTime, parseApiDate, atlasInlineSpinnerHtml } from '../utils.js';
import { t } from '../i18n.js';
import { DEFAULT_BUBBLE_STYLE, bubbleThemeCssVars, normalizeBubbleStyle } from '../bubbleThemes.js';
import {
    applyChatBackground,
    buildChatBgPanelHtml,
    clearChatBackground,
    compressChatBgImage,
    setChatBackground,
} from '../chatBackground.js';

const CACHE_TTL_MS = 30000;
const CHAT_PAGE_SIZE = 50;
const CHAT_TIME_GAP_MS = 5 * 60 * 1000;
const SESSION_CONV_KEY = 'njuatlas_msg_conv_v1';
/** 列表项头像懒加载，减少首屏并发请求 */
const LIST_AVATAR_OPTS = { lazy: true };

let currentTab = 'chats';
let openChatPeerId = null;
let _bound = false;
let _searchSeq = 0;
let _friendsShellReady = false;
let _pendingPeerHint = null;

const tabCache = {
    chats: { items: null, at: 0 },
    friends: { friends: null, requests: null, sent: null, at: 0 },
    interact: { items: null, at: 0 },
};

const chatState = {
    peerId: null,
    peer: null,
    messages: [],
    page: 1,
    total: 0,
    hasMoreOlder: false,
    loadingMore: false,
    myBubbleStyle: null,
    peerBubbleStyle: null,
};

function fmtTime(iso) {
    return formatTimeBrief(iso);
}

function isCacheFresh(at) {
    return at && (Date.now() - at) < CACHE_TTL_MS;
}

function _readSessionConversations() {
    try {
        const row = JSON.parse(sessionStorage.getItem(SESSION_CONV_KEY) || 'null');
        if (!row?.items || Date.now() - row.at > CACHE_TTL_MS) return null;
        return row.items;
    } catch {
        return null;
    }
}

function _persistSessionConversations(items) {
    try {
        sessionStorage.setItem(SESSION_CONV_KEY, JSON.stringify({
            at: Date.now(),
            items: items || [],
        }));
    } catch { /* quota */ }
}

function _seedChatsFromSession() {
    if (tabCache.chats.items) return;
    const items = _readSessionConversations();
    if (items) {
        tabCache.chats = { items, at: Date.now() - 12000 };
    }
}

function invalidateCache(...keys) {
    keys.forEach((key) => {
        if (key === 'chats') {
            tabCache.chats = { items: null, at: 0 };
            try { sessionStorage.removeItem(SESSION_CONV_KEY); } catch { /* ignore */ }
        }
        if (key === 'friends') tabCache.friends = { friends: null, requests: null, sent: null, at: 0 };
        if (key === 'interact') tabCache.interact = { items: null, at: 0 };
    });
}

function resolveSenderBubbleStyle(senderId, myUserId, myStyle, peerStyle) {
    return Number(senderId) === Number(myUserId) ? myStyle : peerStyle;
}

function notifText(n) {
    const name = n.actor?.username || t('messages.anonymous');
    switch (n.type) {
        case 'like': return t('messages.notifLike', { name });
        case 'comment': return t('messages.notifComment', { name });
        case 'friend_request': return t('messages.notifFriendReq', { name });
        case 'friend_accept': return t('messages.notifFriendAccept', { name });
        default: return t('messages.notifDefault', { name });
    }
}

function campusLabel(name) {
    return name ? t('messages.campusLabel', { name }) : '';
}

function notifActionHtml(n) {
    if (n.type !== 'friend_request' || !n.friendship_id) return '';
    const st = n.friendship_status;
    if (st === 'accepted') return `<span class="msg-notif-handled">${t('messages.handledAccept')}</span>`;
    if (st === 'rejected' || st === 'cancelled') return `<span class="msg-notif-handled">${t('messages.handledReject')}</span>`;
    if (st && st !== 'pending') return '';
    return `
        <div class="msg-notif-actions">
            <button class="msg-mini-btn primary" data-accept="${n.friendship_id}" type="button">${t('messages.accept')}</button>
            <button class="msg-mini-btn" data-reject="${n.friendship_id}" type="button">${t('messages.reject')}</button>
        </div>
    `;
}

function setTabBadge(tabId, count) {
    const tab = document.querySelector(`#messagesPage .msg-tab[data-tab="${tabId}"]`);
    if (!tab) return;
    const n = Math.max(0, Number(count) || 0);
    let badge = tab.querySelector('.msg-badge');
    if (n > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'msg-badge';
            tab.appendChild(badge);
        }
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.hidden = false;
        tab.classList.add('has-badge');
        const label = tab.querySelector('span')?.textContent?.trim() || tabId;
        tab.setAttribute('aria-label', `${label} (${n})`);
    } else {
        tab.classList.remove('has-badge');
        tab.removeAttribute('aria-label');
        if (badge) badge.remove();
    }
}

function clearTabBadges() {
    ['chats', 'friends', 'interact'].forEach((tabId) => setTabBadge(tabId, 0));
}

function normalizeUnreadCounts(data = {}) {
    const messages = Math.max(0, Number(data.messages) || 0);
    const friendRequests = Math.max(0, Number(data.friend_requests) || 0);
    let interact = data.interact;
    if (interact == null) {
        // 兼容旧后端：只有 notifications 字段时，尽量拆到互动 Tab
        const legacyNotif = Math.max(0, Number(data.notifications) || 0);
        interact = Math.max(0, legacyNotif - friendRequests);
    } else {
        interact = Math.max(0, Number(interact) || 0);
    }
    let total = data.total;
    if (total == null || Number.isNaN(Number(total))) {
        total = messages + interact + friendRequests;
    } else {
        total = Math.max(0, Number(total) || 0);
    }
    return { messages, interact, friend_requests: friendRequests, total };
}

async function refreshAllBadges(preloaded, { force = false } = {}) {
    refreshAllBadges._pending = {
        preloaded: preloaded ?? refreshAllBadges._pending?.preloaded,
        force: force || refreshAllBadges._pending?.force,
    };
    clearTimeout(refreshAllBadges._timer);
    refreshAllBadges._timer = setTimeout(async () => {
        refreshAllBadges._timer = null;
        const pending = refreshAllBadges._pending;
        refreshAllBadges._pending = null;
        if (!pending) return;
        try {
            const data = normalizeUnreadCounts(
                pending.preloaded || await getUnreadCounts({ force: Boolean(pending.force) }),
            );
            setTabBadge('chats', data.messages);
            setTabBadge('interact', data.interact);
            setTabBadge('friends', data.friend_requests);
            if (typeof window.refreshUnreadBadge === 'function') {
                await window.refreshUnreadBadge(data);
            }
        } catch {
            clearTabBadges();
            if (typeof window.clearNavUnreadBadges === 'function') window.clearNavUnreadBadges();
        }
    }, 300);
}
refreshAllBadges._timer = null;
refreshAllBadges._pending = null;

async function updateTabBadges() {
    await refreshAllBadges();
}

function renderTabs() {
    document.querySelectorAll('#messagesPage .msg-tab').forEach((el) => {
        el.classList.toggle('active', el.dataset.tab === currentTab);
    });
    ['msgChatsView', 'msgFriendsView', 'msgInteractView'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const map = { chats: 'msgChatsView', friends: 'msgFriendsView', interact: 'msgInteractView' };
    const view = document.getElementById(map[currentTab]);
    if (view) view.style.display = 'block';
}

// ── 会话列表 ──────────────────────────────────────────────────

function convoListHtml(items) {
    if (!items?.length) {
        return `<div class="msg-empty"><i class="fas fa-comments"></i><p>${t('messages.noChats')}</p></div>`;
    }
    return items.map((c) => `
        <button class="msg-convo-item" data-chat="${c.peer_id}" type="button">
            ${avatarHtmlForUser(c.peer, 48, LIST_AVATAR_OPTS)}
            <div class="msg-convo-main">
                <div class="msg-convo-top">
                    <span class="msg-convo-name">${escapeHtml(c.peer?.username || t('messages.user'))}</span>
                    <span class="msg-convo-time">${fmtTime(c.last_at)}</span>
                </div>
                <div class="msg-convo-preview">${escapeHtml(c.last_message || '')}${c.unread_count ? ` <span class="msg-unread-dot">${c.unread_count}</span>` : ''}</div>
            </div>
        </button>`).join('');
}

function paintConvoList(items) {
    const list = document.getElementById('msgConvoList');
    if (!list) return;
    const sig = (items || []).map((c) => `${c.peer_id}:${c.last_at}:${c.unread_count}:${c.last_message}`).join('|');
    if (sig === paintConvoList._lastSig) return;
    paintConvoList._lastSig = sig;
    list.innerHTML = convoListHtml(items);
}
paintConvoList._lastSig = '';

async function fetchConversations({ silent = false, useBootstrap = false } = {}) {
    if (useBootstrap) {
        const data = await getInboxBootstrap();
        const items = data.conversations?.items || [];
        tabCache.chats = { items, at: Date.now() };
        _persistSessionConversations(items);
        invalidateUnreadCache();
        refreshAllBadges(data.unread);
        return items;
    }
    const data = await listDmConversations(silent);
    const items = data.items || [];
    tabCache.chats = { items, at: Date.now() };
    _persistSessionConversations(items);
    return items;
}

function ensureConvoWrap(view) {
    if (view.querySelector('#msgConvoWrap')) return;
    view.innerHTML = `
        <div id="msgConvoWrap">
            <div id="msgConvoList" class="msg-convo-list"></div>
        </div>
        <div id="msgChatWrap" hidden></div>`;
}

function showConvoList() {
    document.getElementById('msgConvoWrap')?.removeAttribute('hidden');
    document.getElementById('msgChatWrap')?.setAttribute('hidden', '');
}

function showChatRoom() {
    document.getElementById('msgConvoWrap')?.setAttribute('hidden', '');
    document.getElementById('msgChatWrap')?.removeAttribute('hidden');
}

async function renderChats({ force = false } = {}) {
    const view = document.getElementById('msgChatsView');
    if (!view) return;

    if (force) paintConvoList._lastSig = '';

    if (openChatPeerId) {
        showChatRoom();
        await openChatRoom(openChatPeerId, { force });
        return;
    }

    ensureConvoWrap(view);
    showConvoList();

    const cached = tabCache.chats.items;
    const fresh = !force && isCacheFresh(tabCache.chats.at);

    if (cached) {
        paintConvoList(cached);
    } else {
        const list = document.getElementById('msgConvoList');
        if (list) list.innerHTML = `<div class="msg-skeleton">${t('common.loading')}</div>`;
    }

    if (fresh) {
        fetchConversations({ silent: true })
            .then((items) => { paintConvoList(items); updateTabBadges(); startRealtimeSync(); })
            .catch(() => {});
        return;
    }

    const useBootstrap = !cached || force;
    try {
        const items = await fetchConversations({ silent: true, useBootstrap });
        paintConvoList(items);
        if (!useBootstrap) updateTabBadges();
        startRealtimeSync();
    } catch {
        const list = document.getElementById('msgConvoList');
        if (list) list.innerHTML = `<div class="msg-empty-sm">${t('messages.loadFail')}</div>`;
    }
}

// ── 聊天室 ────────────────────────────────────────────────────

function syncBubbleStyles() {
    const me = getUser();
    chatState.myBubbleStyle = normalizeBubbleStyle(me?.bubble_style || DEFAULT_BUBBLE_STYLE);
    chatState.peerBubbleStyle = normalizeBubbleStyle(chatState.peer?.bubble_style || DEFAULT_BUBBLE_STYLE);
}

function bubbleRowHtml(m, { pending = false } = {}) {
    const me = getUser();
    const myUserId = me?.id;
    const peer = chatState.peer || { id: chatState.peerId };
    const style = bubbleThemeCssVars(
        resolveSenderBubbleStyle(m.sender_id, myUserId, chatState.myBubbleStyle, chatState.peerBubbleStyle)
    );
    const pendingCls = pending ? ' is-pending' : '';
    const tempAttr = m._tempId ? ` data-temp-id="${m._tempId}"` : '';
    const idAttr = m.id ? ` data-msg-id="${m.id}"` : '';
    const pendingSpinner = (m.is_mine && pending)
        ? atlasInlineSpinnerHtml({ label: t('messages.sending'), className: 'msg-send-spinner' })
        : '';
    return `
        <div class="msg-bubble-row ${m.is_mine ? 'me' : 'them'}${pendingCls}"${tempAttr}${idAttr}>
            ${m.is_mine ? '' : avatarHtmlForUser(peer, 32)}
            <div class="msg-bubble" style="${style}">${escapeHtml(m.content)}</div>
            ${pendingSpinner}
        </div>`;
}

function createBubbleRowElement(message, { pending = false } = {}) {
    const wrap = document.createElement('div');
    wrap.innerHTML = bubbleRowHtml(message, { pending });
    return wrap.firstElementChild;
}

function messageTimestampMs(m) {
    if (!m?.created_at) return null;
    const d = parseApiDate(m.created_at);
    if (!d || Number.isNaN(d.getTime())) return null;
    return d.getTime();
}

/** 两条消息之间是否需要插入居中时间条 */
function needsChatTimeDivider(prevMsg, currMsg) {
    const currMs = messageTimestampMs(currMsg);
    if (currMs == null) return false;
    if (!prevMsg) return true;
    const prevMs = messageTimestampMs(prevMsg);
    if (prevMs == null) return true;
    return currMs - prevMs > CHAT_TIME_GAP_MS;
}

function createChatTimeDividerElement(iso) {
    const text = formatChatDividerTime(iso);
    if (!text) return null;
    const el = document.createElement('div');
    el.className = 'msg-time-divider';
    el.setAttribute('role', 'separator');
    el.textContent = text;
    return el;
}

function getPreviousChatMessage(message) {
    const idx = chatState.messages.indexOf(message);
    if (idx > 0) return chatState.messages[idx - 1];
    if (idx === 0) return null;
    const len = chatState.messages.length;
    return len ? chatState.messages[len - 1] : null;
}

/** 将消息行（含 QQ 式时间条）追加到 fragment */
function appendChatRowsToFragment(frag, messages, { startPrev = null } = {}) {
    let prev = startPrev;
    for (const m of messages) {
        if (needsChatTimeDivider(prev, m)) {
            const divider = createChatTimeDividerElement(m.created_at);
            if (divider) frag.appendChild(divider);
        }
        const row = createBubbleRowElement(m);
        if (row) frag.appendChild(row);
        if (messageTimestampMs(m) != null) prev = m;
    }
    return prev;
}

function syncBoundaryTimeDivider(lastOlder, nextExisting, firstRow) {
    if (!nextExisting || !firstRow) return;
    const body = firstRow.parentElement;
    if (!body) return;
    let prevEl = firstRow.previousElementSibling;
    if (prevEl?.id === 'msgLoadMoreHint') prevEl = prevEl.previousElementSibling;
    const need = needsChatTimeDivider(lastOlder, nextExisting);
    if (need) {
        const divider = createChatTimeDividerElement(nextExisting.created_at);
        if (!divider) return;
        if (prevEl?.classList.contains('msg-time-divider')) {
            prevEl.textContent = divider.textContent;
        } else {
            body.insertBefore(divider, firstRow);
        }
    } else if (prevEl?.classList.contains('msg-time-divider')) {
        prevEl.remove();
    }
}

function syncLoadMoreHint(body = document.getElementById('msgChatBody')) {
    if (!body) return;
    const hint = body.querySelector('#msgLoadMoreHint');
    if (chatState.hasMoreOlder) {
        if (hint) return;
        const el = document.createElement('div');
        el.className = 'msg-load-hint';
        el.id = 'msgLoadMoreHint';
        el.textContent = t('messages.loadOlder');
        body.insertBefore(el, body.firstChild);
    } else {
        hint?.remove();
    }
}

function prependOlderBubbles(olderMessages, nextExistingMsg = null) {
    const body = document.getElementById('msgChatBody');
    if (!body || !olderMessages?.length) return;

    body.querySelector('.msg-empty-sm')?.remove();

    const frag = document.createDocumentFragment();
    appendChatRowsToFragment(frag, olderMessages);

    const firstRow = body.querySelector('.msg-bubble-row');
    if (firstRow) {
        body.insertBefore(frag, firstRow);
        syncBoundaryTimeDivider(olderMessages[olderMessages.length - 1], nextExistingMsg, firstRow);
    } else {
        const hint = body.querySelector('#msgLoadMoreHint');
        if (hint) hint.after(frag);
        else body.prepend(frag);
    }
}

function paintChatMessages({ scrollToBottom = true } = {}) {
    const body = document.getElementById('msgChatBody');
    if (!body) return;

    const frag = document.createDocumentFragment();

    if (!chatState.messages.length) {
        const empty = document.createElement('div');
        empty.className = 'msg-empty-sm';
        empty.textContent = t('messages.startChat');
        frag.appendChild(empty);
    } else {
        appendChatRowsToFragment(frag, chatState.messages);
    }

    body.replaceChildren(frag);
    syncLoadMoreHint(body);
    applyChatBackground(body, chatState.peerId);
    if (scrollToBottom) body.scrollTop = body.scrollHeight;
}

function updateChatHeader() {
    const peer = chatState.peer || { username: t('messages.user') };
    const title = document.getElementById('msgChatTitle');
    const avatarSlot = document.getElementById('msgChatAvatar');
    if (title) title.textContent = peer.username || t('messages.user');
    if (avatarSlot) avatarSlot.innerHTML = avatarHtmlForUser(peer, 36);
}

function ensureChatShell(view, peerId) {
    const wrap = document.getElementById('msgChatWrap');
    if (!wrap) return;

    const needRebuild = !wrap.querySelector('.msg-chatroom') || Number(wrap.dataset.peerId) !== peerId;
    if (!needRebuild) return;

    wrap.dataset.peerId = String(peerId);
    wrap.innerHTML = `
        <div class="msg-chatroom">
            <div class="msg-chat-header">
                <button class="msg-back-btn" id="msgBackBtn" type="button"><i class="fas fa-arrow-left"></i></button>
                <span id="msgChatAvatar"></span>
                <span class="msg-chat-title" id="msgChatTitle"></span>
                <button class="msg-chat-bg-btn" id="msgChatBgBtn" type="button" aria-label="${t('messages.chatBgBtn')}" title="${t('messages.chatBg')}">
                    <i class="fas fa-image"></i>
                </button>
            </div>
            <div class="msg-chat-body" id="msgChatBody" data-peer-id="${peerId}"></div>
            <form class="msg-chat-input" id="msgChatForm">
                <input type="text" id="msgChatText" placeholder="${t('messages.chatPlaceholder')}" autocomplete="off" maxlength="500">
                <button type="submit" class="msg-send-btn"><i class="fas fa-paper-plane"></i></button>
            </form>
            ${buildChatBgPanelHtml(peerId)}
        </div>`;

    bindChatScrollLoad();
}

function bindChatScrollLoad() {
    const body = document.getElementById('msgChatBody');
    if (!body || body.dataset.scrollBound === '1') return;
    body.dataset.scrollBound = '1';

    body.addEventListener('scroll', () => {
        if (chatState.loadingMore || !chatState.hasMoreOlder) return;
        if (body.scrollTop > 80) return;
        loadOlderMessages();
    });
}

const CHAT_POLL_MS = 8000;
const CONVO_POLL_MS = 15000;
const SSE_RETRY_BASE_MS = 2000;
const SSE_RETRY_MAX_MS = 30000;

let _convoSyncTimer = null;
let _syncMode = null;
let _chatSyncActive = false;
let _chatSyncAbort = null;
let _convoSyncInFlight = false;
let _visibilityBound = false;
let _eventSource = null;
let _sseConnected = false;
let _sseRetryTimer = null;
let _sseRetryMs = SSE_RETRY_BASE_MS;
let _backendRealtimeMode = null;
let _streamStartTimer = null;

async function ensureBackendRealtimeMode() {
    if (_backendRealtimeMode !== null) return _backendRealtimeMode;
    if (API_BASE.includes('api.njuatlas.cn') || API_BASE.includes('onrender.com')) {
        _backendRealtimeMode = 'redis';
        return _backendRealtimeMode;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
        const res = await fetch(`${API_BASE}/health`, { signal: controller.signal });
        const data = await res.json();
        _backendRealtimeMode = data.realtime === 'redis' ? 'redis' : 'memory';
    } catch {
        _backendRealtimeMode = 'memory';
    } finally {
        clearTimeout(timeoutId);
    }
    return _backendRealtimeMode;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getLastConfirmedMessageId() {
    let max = 0;
    for (const m of chatState.messages) {
        if (m.id && m.id > max) max = m.id;
    }
    return max;
}

function isChatNearBottom(body, threshold = 96) {
    if (!body) return true;
    return body.scrollHeight - body.scrollTop - body.clientHeight < threshold;
}

function stopPollingSync() {
    if (_convoSyncTimer) clearInterval(_convoSyncTimer);
    _convoSyncTimer = null;
    _syncMode = null;
    _chatSyncActive = false;
    if (_chatSyncAbort) {
        _chatSyncAbort.abort();
        _chatSyncAbort = null;
    }
}

function stopMessageStream() {
    _sseConnected = false;
    if (_streamStartTimer) {
        clearTimeout(_streamStartTimer);
        _streamStartTimer = null;
    }
    if (_sseRetryTimer) {
        clearTimeout(_sseRetryTimer);
        _sseRetryTimer = null;
    }
    if (_eventSource) {
        _eventSource.close();
        _eventSource = null;
    }
}

function scheduleMessageStreamReconnect() {
    if (_backendRealtimeMode === 'memory' || _sseRetryTimer) return;
    _sseRetryTimer = setTimeout(() => {
        _sseRetryTimer = null;
        if (!document.getElementById('messagesPage')?.classList.contains('active-page') || !getUser()) return;
        startMessageStream();
    }, _sseRetryMs);
}

function handleStreamPayload(raw) {
    let payload;
    try {
        payload = JSON.parse(raw);
    } catch {
        return;
    }
    if (payload.type === 'dm') {
        const peerId = payload.data?.peer_id;
        const message = payload.data?.message;
        if (!peerId || !message?.id) return;
        const inChat = openChatPeerId && Number(openChatPeerId) === Number(peerId);
        if (inChat && Number(chatState.peerId) === Number(peerId)) {
            applyIncomingChatMessages(peerId, { items: [message] });
            if (!message.is_mine) {
                markDmThreadRead(peerId)
                    .then(() => {
                        invalidateUnreadCache();
                        refreshAllBadges(null);
                    })
                    .catch(() => {});
            }
        } else {
            invalidateCache('chats');
            if (currentTab === 'chats' && !openChatPeerId) {
                fetchConversations().then(paintConvoList).catch(() => {});
            }
        }
        refreshAllBadges(null);
        return;
    }
    if (payload.type === 'unread') {
        invalidateUnreadCache();
        refreshAllBadges(null);
        scheduleSocialTabRefresh();
    }
}

function startMessageStream() {
    if (_backendRealtimeMode === 'memory') return;
    const token = getAuthToken();
    if (!token || !getUser()) return;
    if (_eventSource) return;

    const url = `${API_BASE}/social/events/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    _eventSource = es;

    const onConnected = () => {
        _sseConnected = true;
        _sseRetryMs = SSE_RETRY_BASE_MS;
        window._unreadPollingPaused = true;
        stopPollingSync();
    };

    es.addEventListener('ready', onConnected);
    es.addEventListener('message', (e) => {
        if (e.data) handleStreamPayload(e.data);
    });
    es.onopen = onConnected;
    es.onerror = () => {
        stopMessageStream();
        _sseRetryMs = Math.min(Math.round(_sseRetryMs * 1.5), SSE_RETRY_MAX_MS);
        startPollingSync();
        scheduleMessageStreamReconnect();
    };
}

function startPollingSync() {
    window._unreadPollingPaused = true;
    if (
        openChatPeerId
        && chatState.peerId
        && Number(openChatPeerId) === Number(chatState.peerId)
    ) {
        _syncMode = 'chat';
        _chatSyncActive = true;
        void runChatSyncLoop();
    } else if (currentTab === 'chats' && !openChatPeerId && !_sseConnected) {
        _syncMode = 'convo';
        void pollConvoOnce();
        _convoSyncTimer = setInterval(pollConvoOnce, CONVO_POLL_MS);
    }
}

function stopRealtimeSync() {
    stopPollingSync();
    stopMessageStream();
    window._unreadPollingPaused = false;
}

function schedulePollingFallback() {
    clearTimeout(schedulePollingFallback._timer);
    schedulePollingFallback._timer = setTimeout(() => {
        schedulePollingFallback._timer = null;
        if (_sseConnected || document.hidden) return;
        if (!document.getElementById('messagesPage')?.classList.contains('active-page')) return;
        startPollingSync();
    }, 3000);
}
schedulePollingFallback._timer = null;

function startRealtimeSync() {
    stopPollingSync();
    if (!getUser()) return;
    const onMessagesPage = document.getElementById('messagesPage')?.classList.contains('active-page');
    if (!onMessagesPage || document.hidden) {
        stopMessageStream();
        return;
    }

    clearTimeout(_streamStartTimer);
    _streamStartTimer = setTimeout(async () => {
        _streamStartTimer = null;
        if (!document.getElementById('messagesPage')?.classList.contains('active-page') || document.hidden) return;
        const mode = await ensureBackendRealtimeMode();
        if (mode === 'redis') startMessageStream();
        if (!_sseConnected) schedulePollingFallback();
    }, 0);
}

/** 将 SSE/轮询到的自己发出的消息与乐观气泡合并，避免重复显示 */
function reconcileOwnOutgoingMessage(message, { tempId = null } = {}) {
    if (!message?.id) return false;

    const body = document.getElementById('msgChatBody');
    if (!body) return false;

    const existing = body.querySelector(`[data-msg-id="${message.id}"]`);
    if (existing) {
        if (tempId) body.querySelector(`[data-temp-id="${tempId}"]`)?.remove();
        if (!chatState.messages.some((x) => x.id === message.id)) {
            chatState.messages.push(message);
        }
        return true;
    }

    const pendingRow = tempId
        ? body.querySelector(`[data-temp-id="${tempId}"]`)
        : [...body.querySelectorAll('.msg-bubble-row.me.is-pending')].find((row) => {
            const text = row.querySelector('.msg-bubble')?.textContent;
            return text === message.content;
        });

    if (pendingRow) {
        pendingRow.classList.remove('is-pending');
        pendingRow.querySelector('.msg-send-spinner')?.remove();
        pendingRow.removeAttribute('data-temp-id');
        pendingRow.setAttribute('data-msg-id', String(message.id));
        const stateIdx = tempId
            ? chatState.messages.findIndex((x) => x._tempId === tempId)
            : chatState.messages.findIndex((x) => x.is_mine && !x.id && x.content === message.content);
        if (stateIdx >= 0) {
            chatState.messages[stateIdx] = { ...chatState.messages[stateIdx], ...message };
        } else if (!chatState.messages.some((x) => x.id === message.id)) {
            chatState.messages.push(message);
        }
        return true;
    }

    return false;
}

function applyIncomingChatMessages(peerId, data) {
    const body = document.getElementById('msgChatBody');
    const stickBottom = isChatNearBottom(body);

    const incoming = (data.items || []).filter(
        (m) => m.id && !chatState.messages.some((x) => x.id === m.id),
    );
    if (!incoming.length) return;

    for (const m of incoming) {
        if (m.is_mine && reconcileOwnOutgoingMessage(m)) continue;
        chatState.messages.push(m);
        appendChatBubble(m, { scroll: false });
        if (!m.is_mine) {
            bumpLocalConvoPreview(peerId, m.content);
        }
    }
    if (stickBottom && body) body.scrollTop = body.scrollHeight;
}

function scheduleSocialTabRefresh() {
    clearTimeout(scheduleSocialTabRefresh._timer);
    scheduleSocialTabRefresh._timer = setTimeout(() => {
        scheduleSocialTabRefresh._timer = null;
        if (currentTab === 'friends' && !openChatPeerId) {
            renderFriends({ force: true }).catch(() => {});
        }
        if (currentTab === 'interact' && !openChatPeerId) {
            renderInteract({ force: true }).catch(() => {});
        }
    }, 450);
}
scheduleSocialTabRefresh._timer = null;

async function runChatSyncLoop() {
    while (_chatSyncActive && _syncMode === 'chat' && !document.hidden) {
        const peerId = openChatPeerId || chatState.peerId;
        if (!peerId) break;

        if (_chatSyncAbort) _chatSyncAbort.abort();
        _chatSyncAbort = new AbortController();
        const { signal } = _chatSyncAbort;

        const afterId = getLastConfirmedMessageId();
        try {
            const data = await getDmMessages(
                peerId,
                { after_id: afterId },
                true,
                undefined,
                signal,
            );
            applyIncomingChatMessages(peerId, data);
        } catch (err) {
            if (!_chatSyncActive || _syncMode !== 'chat' || signal.aborted || err?.name === 'AbortError') break;
        }

        if (!_chatSyncActive || _syncMode !== 'chat' || document.hidden) break;
        await sleep(CHAT_POLL_MS);
    }
}

async function pollConvoOnce() {
    if (_convoSyncInFlight || document.hidden || _syncMode !== 'convo' || openChatPeerId) return;
    _convoSyncInFlight = true;
    try {
        const items = await fetchConversations({ silent: true });
        paintConvoList(items);
        refreshAllBadges(null);
    } catch { /* 静默 */ } finally {
        _convoSyncInFlight = false;
    }
}

function bindVisibilitySync() {
    if (_visibilityBound) return;
    _visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopRealtimeSync();
        } else if (document.getElementById('messagesPage')?.classList.contains('active-page')) {
            startRealtimeSync();
        }
    });
}

async function fetchChatThread(peerId) {
    const data = await getDmMessages(peerId, { tail: true, page_size: CHAT_PAGE_SIZE });
    const peer = data.peer || { id: peerId, username: t('messages.user') };
    const messages = data.items || [];
    const hasMoreOlder = Boolean(data.has_more);
    return { peer, messages, hasMoreOlder };
}

/** 打开聊天时本地清零未读，返回列表时再 force 刷新会话 */
function clearLocalConvoUnread(peerId) {
    const items = tabCache.chats.items;
    if (!Array.isArray(items)) return;
    const idx = items.findIndex((c) => Number(c.peer_id) === Number(peerId));
    if (idx < 0 || !items[idx].unread_count) return;
    const next = items.slice();
    next[idx] = { ...next[idx], unread_count: 0 };
    tabCache.chats.items = next;
    tabCache.chats.at = Date.now();
    _persistSessionConversations(next);
}

async function openChatRoom(peerId, { force = false, peerHint = null } = {}) {
    const view = document.getElementById('msgChatsView');
    if (!view) return;

    ensureConvoWrap(view);
    ensureChatShell(view, peerId);
    showChatRoom();

    const samePeer = chatState.peerId === peerId && chatState.messages.length && !force;
    if (samePeer) {
        updateChatHeader();
        paintChatMessages({ scrollToBottom: false });
        startRealtimeSync();
        return;
    }

    chatState.peerId = peerId;
    chatState.messages = [];
    chatState.page = 1;
    chatState.total = 0;
    chatState.hasMoreOlder = false;

    const body = document.getElementById('msgChatBody');
    if (body) body.innerHTML = `<div class="msg-skeleton">${t('common.loading')}</div>`;
    startRealtimeSync();

    try {
        const cachedPeer = peerHint
            || _pendingPeerHint
            || tabCache.chats.items?.find((c) => c.peer_id === peerId)?.peer;
        _pendingPeerHint = null;
        const { peer, messages, hasMoreOlder } = await fetchChatThread(peerId);
        const duringLoad = chatState.messages.filter((m) => m.id);
        const fetchedIds = new Set(messages.map((m) => m.id));
        const merged = [...messages];
        for (const m of duringLoad) {
            if (m.id && !fetchedIds.has(m.id)) merged.push(m);
        }
        merged.sort((a, b) => (a.id || 0) - (b.id || 0));
        chatState.peer = cachedPeer || peer;
        chatState.messages = merged;
        chatState.hasMoreOlder = hasMoreOlder;
        chatState.page = hasMoreOlder ? 2 : 1;
        chatState.total = messages.length;
        syncBubbleStyles();
        updateChatHeader();
        paintChatMessages({ scrollToBottom: true });
        document.getElementById('msgChatText')?.focus();
        clearLocalConvoUnread(peerId);
        markDmThreadRead(peerId)
            .then(() => {
                invalidateUnreadCache();
                return refreshAllBadges(null, { force: true });
            })
            .catch(() => {});
    } catch (e) {
        if (body) body.innerHTML = `<div class="msg-empty-sm">${escapeHtml(e.message || t('messages.chatLoadFail'))}</div>`;
    }
}

async function loadOlderMessages() {
    if (chatState.loadingMore || !chatState.hasMoreOlder || !chatState.peerId) return;
    const oldest = chatState.messages[0];
    if (!oldest?.id) return;

    chatState.loadingMore = true;
    const body = document.getElementById('msgChatBody');
    const prevHeight = body?.scrollHeight || 0;

    try {
        const data = await getDmMessages(chatState.peerId, {
            before_id: oldest.id,
            page_size: CHAT_PAGE_SIZE,
        });
        const older = data.items || [];
        if (older.length) {
            const existingIds = new Set(chatState.messages.map((m) => m.id));
            const uniqueOlder = older.filter((m) => m.id && !existingIds.has(m.id));
            if (uniqueOlder.length) {
                const firstExisting = chatState.messages[0];
                chatState.messages = [...uniqueOlder, ...chatState.messages];
                prependOlderBubbles(uniqueOlder, firstExisting);
                if (body) body.scrollTop = body.scrollHeight - prevHeight;
            }
        }
        chatState.hasMoreOlder = Boolean(data.has_more);
        syncLoadMoreHint(body);
        if (chatState.hasMoreOlder) chatState.page += 1;
        else chatState.page = 1;
    } catch { /* 静默 */ }
    chatState.loadingMore = false;
}

function appendChatBubble(message, { pending = false, scroll = true } = {}) {
    const body = document.getElementById('msgChatBody');
    if (!body) return;

    const empty = body.querySelector('.msg-empty-sm');
    if (empty) empty.remove();

    const prevMsg = getPreviousChatMessage(message);
    if (needsChatTimeDivider(prevMsg, message)) {
        const divider = createChatTimeDividerElement(message.created_at);
        if (divider) body.appendChild(divider);
    }

    const row = createBubbleRowElement(message, { pending });
    if (!row) return;
    body.appendChild(row);
    if (scroll) body.scrollTop = body.scrollHeight;
}

let _sendQueue = Promise.resolve();
let _convoRefreshTimer = null;
const CONVO_REFRESH_DEBOUNCE_MS = 2500;

function scheduleConvoListSync() {
    clearTimeout(_convoRefreshTimer);
    _convoRefreshTimer = setTimeout(() => {
        _convoRefreshTimer = null;
        fetchConversations()
            .then((items) => {
                if (!openChatPeerId) paintConvoList(items);
                refreshAllBadges();
            })
            .catch(() => {});
    }, CONVO_REFRESH_DEBOUNCE_MS);
}

/** 发送后本地更新会话预览，避免每条消息都拉全量会话列表 */
function bumpLocalConvoPreview(peerId, text) {
    const now = new Date().toISOString();
    let items = tabCache.chats.items;
    if (!Array.isArray(items)) {
        tabCache.chats.items = items = [];
    }
    const idx = items.findIndex((c) => c.peer_id === peerId);
    const peer = chatState.peer || (idx >= 0 ? items[idx].peer : null);
    const entry = {
        peer_id: peerId,
        peer: peer || { id: peerId, username: t('messages.user') },
        last_message: text,
        last_at: now,
        unread_count: 0,
    };
    if (idx >= 0) items[idx] = { ...items[idx], ...entry };
    else items.unshift(entry);
    items.sort((a, b) => (b.last_at || '').localeCompare(a.last_at || ''));
    tabCache.chats.at = Date.now();
}

function enqueueSendChatMessage(text) {
    const peerId = openChatPeerId;
    if (!peerId || !text) return;

    const me = getUser();
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const optimistic = {
        _tempId: tempId,
        sender_id: me?.id,
        content: text,
        is_mine: true,
        created_at: new Date().toISOString(),
    };

    chatState.messages.push(optimistic);
    appendChatBubble(optimistic, { pending: true });
    bumpLocalConvoPreview(peerId, text);

    _sendQueue = _sendQueue
        .then(() => sendChatMessageOnce(peerId, tempId, text))
        .catch(() => {});
}

async function sendChatMessageOnce(peerId, tempId, text) {
    try {
        const saved = await sendDmMessage(peerId, text);
        const confirmed = {
            id: saved.id,
            sender_id: saved.sender_id,
            content: saved.content,
            is_mine: true,
            created_at: saved.created_at,
        };
        if (!reconcileOwnOutgoingMessage(confirmed, { tempId })) {
            chatState.messages.push(confirmed);
            appendChatBubble(confirmed);
        }
        scheduleConvoListSync();
    } catch (err) {
        const row = document.querySelector(`[data-temp-id="${tempId}"]`);
        const dividerBefore = row?.previousElementSibling?.classList?.contains('msg-time-divider')
            ? row.previousElementSibling
            : null;
        row?.remove();
        const failIdx = chatState.messages.findIndex((x) => x._tempId === tempId);
        if (failIdx >= 0) chatState.messages.splice(failIdx, 1);
        if (dividerBefore && failIdx === 0) dividerBefore.remove();
        showToast(err.message || t('messages.sendFail'));
    }
}

// ── 好友页 ────────────────────────────────────────────────────

function friendRequestRowHtml(r) {
    return `
        <div class="msg-friend-item" data-request-id="${r.id}">
            ${avatarHtmlForUser(r.requester, 44, LIST_AVATAR_OPTS)}
            <div class="msg-friend-main">
                <span class="msg-friend-name">${escapeHtml(r.requester?.username || '')}</span>
                <span class="msg-friend-bio">${escapeHtml(r.requester?.campus ? campusLabel(r.requester.campus) : t('messages.friendRequestBio'))}</span>
            </div>
            <div class="msg-friend-actions">
                <button class="msg-mini-btn primary" data-accept="${r.id}" type="button">${t('messages.accept')}</button>
                <button class="msg-mini-btn" data-reject="${r.id}" type="button">${t('messages.reject')}</button>
            </div>
        </div>`;
}

function sentRequestRowHtml(r) {
    return `
        <div class="msg-friend-item" data-sent-id="${r.id}">
            ${avatarHtmlForUser(r.addressee, 44, LIST_AVATAR_OPTS)}
            <div class="msg-friend-main">
                <span class="msg-friend-name">${escapeHtml(r.addressee?.username || '')}</span>
                <span class="msg-friend-bio">${escapeHtml(r.addressee?.campus ? campusLabel(r.addressee.campus) : t('messages.waitPending'))}</span>
            </div>
            <div class="msg-friend-actions">
                <button class="msg-mini-btn" data-cancel-request="${r.id}" type="button">${t('messages.cancelRequest')}</button>
            </div>
        </div>`;
}

function friendRowHtml(u) {
    return `
        <div class="msg-friend-item" data-friend-id="${u.id}">
            ${avatarHtmlForUser(u, 44, LIST_AVATAR_OPTS)}
            <div class="msg-friend-main">
                <span class="msg-friend-name">${escapeHtml(u.username || '')}</span>
                <span class="msg-friend-bio">${escapeHtml(u.bio || u.campus ? `${u.campus || ''} ${u.bio || ''}`.trim() : '')}</span>
            </div>
            <div class="msg-friend-actions">
                <button class="msg-mini-btn primary" data-chat-with="${u.id}" type="button"><i class="fas fa-comment"></i> ${t('messages.sendMsg')}</button>
                <button class="msg-mini-btn" data-view-user="${u.id}" type="button">${t('messages.homepage')}</button>
                <button class="msg-mini-btn danger" data-remove-friend="${u.id}" type="button">${t('messages.removeFriend')}</button>
            </div>
        </div>`;
}

function searchResultRowHtml(u) {
    return `
        <div class="msg-friend-item">
            ${avatarHtmlForUser(u, 40, LIST_AVATAR_OPTS)}
            <div class="msg-friend-main">
                <span class="msg-friend-name">${escapeHtml(u.username)}</span>
                <span class="msg-friend-bio">${escapeHtml(u.bio || u.campus || '')}</span>
            </div>
            ${u.friendship_status === 'friends' ? `
                    <div class="msg-friend-actions">
                        <button class="msg-mini-btn primary" data-chat-with="${u.id}" type="button"><i class="fas fa-comment"></i> ${t('messages.sendMsg')}</button>
                        <button class="msg-mini-btn" data-view-user="${u.id}" type="button">${t('messages.homepage')}</button>
                        <button class="msg-mini-btn danger" data-remove-friend="${u.id}" type="button">${t('messages.removeFriend')}</button>
                    </div>`
                : u.friendship_status === 'pending_sent' && u.friendship_request_id ? `
                    <div class="msg-friend-actions">
                        <span class="msg-tag-pending">${t('messages.pendingSent')}</span>
                        <button class="msg-mini-btn" data-cancel-request="${u.friendship_request_id}" type="button">${t('messages.cancelRequest')}</button>
                    </div>`
                : u.friendship_status === 'pending_sent' ? `<span class="msg-tag-pending">${t('messages.pendingSent')}</span>`
                : u.friendship_status === 'pending_received' && u.friendship_request_id ? `
                    <div class="msg-friend-actions">
                        <button class="msg-mini-btn primary" data-accept="${u.friendship_request_id}" type="button">${t('messages.accept')}</button>
                        <button class="msg-mini-btn" data-reject="${u.friendship_request_id}" type="button">${t('messages.reject')}</button>
                    </div>`
                : u.friendship_status === 'pending_received' ? `<span class="msg-tag-pending">${t('messages.pendingReceived')}</span>`
                : `<button class="msg-mini-btn primary" data-add="${u.id}" type="button">${t('messages.addFriend')}</button>`}
        </div>`;
}

function ensureFriendsShell(view) {
    if (_friendsShellReady && view.querySelector('#msgFriendsLayout')) return;
    _friendsShellReady = true;
    view.innerHTML = `
        <div id="msgFriendsLayout" class="msg-friends-layout">
            <div class="msg-add-row">
                <input type="text" id="msgAddInput" data-i18n-placeholder="messages.searchFriend" placeholder="${t('messages.searchFriend')}" autocomplete="off">
                <button class="msg-mini-btn primary" id="msgAddBtn" type="button"><i class="fas fa-user-plus"></i> ${t('messages.addFriend')}</button>
            </div>
            <div id="msgAddResults" class="msg-add-results"></div>
            <div id="msgRequestsBlock" hidden>
                <h4 class="msg-section-title msg-section-highlight" id="msgRequestsTitle"></h4>
                <div id="msgRequestsList"></div>
            </div>
            <div id="msgSentBlock" hidden>
                <h4 class="msg-section-title" id="msgSentTitle"></h4>
                <div id="msgSentList"></div>
            </div>
            <h4 class="msg-section-title" id="msgFriendsTitle"></h4>
            <div id="msgFriendsList"></div>
        </div>`;
}

function paintFriendsData({ friends = [], requests = [], sent = [] } = {}) {
    const reqBlock = document.getElementById('msgRequestsBlock');
    const reqList = document.getElementById('msgRequestsList');
    const reqTitle = document.getElementById('msgRequestsTitle');
    const sentBlock = document.getElementById('msgSentBlock');
    const sentList = document.getElementById('msgSentList');
    const sentTitle = document.getElementById('msgSentTitle');
    const friendsList = document.getElementById('msgFriendsList');
    const friendsTitle = document.getElementById('msgFriendsTitle');

    if (requests.length) {
        reqBlock.hidden = false;
        reqTitle.textContent = t('messages.sectionNew', { n: requests.length });
        reqList.innerHTML = requests.map(friendRequestRowHtml).join('');
    } else if (reqBlock) {
        reqBlock.hidden = true;
        if (reqList) reqList.innerHTML = '';
    }

    if (sent.length) {
        sentBlock.hidden = false;
        sentTitle.textContent = t('messages.sectionSent', { n: sent.length });
        sentList.innerHTML = sent.map(sentRequestRowHtml).join('');
    } else if (sentBlock) {
        sentBlock.hidden = true;
        if (sentList) sentList.innerHTML = '';
    }

    if (friendsTitle) friendsTitle.textContent = t('messages.sectionFriends', { n: friends.length });
    if (friendsList) {
        friendsList.innerHTML = friends.length
            ? friends.map(friendRowHtml).join('')
            : `<div class="msg-empty-sm">${t('messages.noFriends')}</div>`;
    }
}

async function fetchFriendsData() {
    try {
        const bundle = await listFriendsBundle();
        const payload = {
            friends: bundle.friends || [],
            requests: bundle.requests || [],
            sent: bundle.sent || [],
        };
        tabCache.friends = { ...payload, at: Date.now() };
        return payload;
    } catch {
        const [friendsData, reqData, sentReqData] = await Promise.all([
            listFriends(),
            listFriendRequests(),
            listSentFriendRequests(),
        ]);
        const payload = {
            friends: friendsData.items || [],
            requests: reqData.items || [],
            sent: sentReqData.items || [],
        };
        tabCache.friends = { ...payload, at: Date.now() };
        return payload;
    }
}

async function renderFriends({ force = false } = {}) {
    const view = document.getElementById('msgFriendsView');
    if (!view) return;

    ensureFriendsShell(view);

    const hadCache = tabCache.friends.friends !== null;
    const fresh = !force && isCacheFresh(tabCache.friends.at);

    if (hadCache) {
        paintFriendsData(tabCache.friends);
    } else {
        const friendsList = document.getElementById('msgFriendsList');
        if (friendsList) friendsList.innerHTML = `<div class="msg-skeleton">${t('common.loading')}</div>`;
    }

    if (fresh) {
        fetchFriendsData()
            .then((data) => { paintFriendsData(data); updateTabBadges(); })
            .catch(() => {});
        return;
    }

    try {
        const data = await fetchFriendsData();
        paintFriendsData(data);
        updateTabBadges();
    } catch {
        const friendsList = document.getElementById('msgFriendsList');
        if (friendsList) friendsList.innerHTML = `<div class="msg-empty-sm">${t('messages.loadFail')}</div>`;
    }
}

async function reloadFriendsPreserveSearch({ refetchFriends = true } = {}) {
    const input = document.getElementById('msgAddInput');
    const keyword = input?.value?.trim() || '';
    const selStart = input?.selectionStart;
    const selEnd = input?.selectionEnd;

    if (refetchFriends) {
        invalidateCache('friends');
        try {
            const data = await fetchFriendsData();
            paintFriendsData(data);
        } catch {
            showToast(t('messages.loadFail'));
        }
    }

    updateTabBadges();

    if (input && keyword) {
        input.value = keyword;
        if (selStart != null) input.setSelectionRange(selStart, selEnd);
        await searchAndRender(keyword);
    }
}

async function searchAndRender(q) {
    const view = document.getElementById('msgAddResults');
    if (!view) return;
    const key = q.trim();
    if (!key) { view.innerHTML = ''; return; }

    const seq = ++_searchSeq;
    view.innerHTML = `<div class="msg-skeleton msg-skeleton-inline">${t('common.loading')}</div>`;

    try {
        const data = await searchUsers(key);
        if (seq !== _searchSeq) return;
        const hits = data.items || [];
        if (!hits.length) {
            view.innerHTML = `<div class="msg-empty-sm">${t('messages.notFound', { key: escapeHtml(key) })}</div>`;
            return;
        }
        view.innerHTML = hits.map(searchResultRowHtml).join('');
    } catch {
        if (seq !== _searchSeq) return;
        view.innerHTML = `<div class="msg-empty-sm">${t('messages.searchFail')}</div>`;
    }
}

function notifListHtml(items) {
    return items.map((n) => `
        <div class="msg-notif-item ${n.is_read ? '' : 'unread'}" data-notif="${n.id}" data-type="${n.type}" data-post="${n.post_id || ''}" data-friendship="${n.friendship_id || ''}" role="button" tabindex="0">
            ${avatarHtmlForUser(n.actor, 40, LIST_AVATAR_OPTS)}
            <div class="msg-notif-main">
                <div class="msg-notif-text">${escapeHtml(notifText(n))}</div>
                ${n.post_title ? `<div class="msg-notif-sub">${escapeHtml(n.post_title)}</div>` : ''}
                <div class="msg-notif-time">${fmtTime(n.created_at)}</div>
                ${notifActionHtml(n)}
            </div>
        </div>`).join('');
}

async function fetchNotifications() {
    const data = await listNotifications();
    const items = data.items || [];
    tabCache.interact = { items, at: Date.now() };
    return items;
}

async function renderInteract({ force = false } = {}) {
    const view = document.getElementById('msgInteractView');
    if (!view) return;

    const fresh = !force && isCacheFresh(tabCache.interact.at);

    if (tabCache.interact.items) {
        const items = tabCache.interact.items;
        view.innerHTML = items.length
            ? `<div class="msg-notif-list">${notifListHtml(items)}</div>`
            : `<div class="msg-empty"><i class="fas fa-bell"></i><p>${t('messages.noInteract')}</p></div>`;
    } else {
        view.innerHTML = `<div class="msg-skeleton">${t('common.loading')}</div>`;
    }

    if (fresh) {
        fetchNotifications()
            .then((items) => {
                view.innerHTML = items.length
                    ? `<div class="msg-notif-list">${notifListHtml(items)}</div>`
                    : `<div class="msg-empty"><i class="fas fa-bell"></i><p>${t('messages.noInteract')}</p></div>`;
                markNotificationsRead(null, { excludeTypes: ['friend_request'] })
                    .then(() => {
                        invalidateUnreadCache();
                        updateTabBadges();
                    })
                    .catch(() => {});
            })
            .catch(() => {});
        return;
    }

    try {
        const items = await fetchNotifications();
        view.innerHTML = items.length
            ? `<div class="msg-notif-list">${notifListHtml(items)}</div>`
            : `<div class="msg-empty"><i class="fas fa-bell"></i><p>${t('messages.noInteract')}</p></div>`;
        markNotificationsRead(null, { excludeTypes: ['friend_request'] })
            .then(() => {
                invalidateUnreadCache();
                updateTabBadges();
            })
            .catch(() => {});
    } catch {
        view.innerHTML = `<div class="msg-empty-sm">${t('messages.loadFail')}</div>`;
    }
}

function bindEvents() {
    if (_bound) return;
    _bound = true;
    const page = document.getElementById('messagesPage');
    if (!page) return;

    page.querySelectorAll('.msg-tab').forEach((tab) => {
        tab.addEventListener('click', async () => {
            currentTab = tab.dataset.tab;
            openChatPeerId = null;
            renderTabs();
            if (currentTab === 'chats') await renderChats();
            else if (currentTab === 'friends') await renderFriends();
            else await renderInteract();
            startRealtimeSync();
        });
    });

    page.addEventListener('click', async (e) => {
        const convo = e.target.closest('[data-chat]');
        if (convo) {
            openChatPeerId = Number(convo.dataset.chat);
            await renderChats();
            return;
        }
        if (e.target.closest('#msgBackBtn')) {
            openChatPeerId = null;
            chatState.peerId = null;
            await renderChats({ force: true });
            return;
        }
        if (e.target.closest('#msgChatBgBtn')) {
            const panel = document.getElementById('msgChatBgPanel');
            if (panel) {
                const open = !panel.classList.contains('is-open');
                panel.hidden = !open;
                panel.classList.toggle('is-open', open);
            }
            return;
        }
        if (e.target.closest('#msgChatBgClose')) {
            const panel = document.getElementById('msgChatBgPanel');
            if (panel) {
                panel.hidden = true;
                panel.classList.remove('is-open');
            }
            return;
        }
        const bgPreset = e.target.closest('[data-chat-bg-preset]');
        if (bgPreset) {
            const peerId = Number(bgPreset.dataset.peerId);
            const presetId = bgPreset.dataset.chatBgPreset;
            if (!peerId) return;
            if (presetId === 'default') clearChatBackground(peerId);
            else setChatBackground(peerId, { type: 'preset', id: presetId });
            applyChatBackground(document.getElementById('msgChatBody'), peerId);
            document.getElementById('msgChatBgPanel')?.querySelectorAll('.msg-chat-bg-swatch').forEach((el) => {
                el.classList.toggle('active', el === bgPreset);
            });
            showToast(presetId === 'default' ? t('messages.bgReset') : t('messages.bgSaved'));
            return;
        }
        const bgReset = e.target.closest('[data-chat-bg-reset]');
        if (bgReset) {
            const peerId = Number(bgReset.dataset.chatBgReset);
            if (!peerId) return;
            clearChatBackground(peerId);
            applyChatBackground(document.getElementById('msgChatBody'), peerId);
            document.getElementById('msgChatBgPanel')?.querySelectorAll('.msg-chat-bg-swatch').forEach((el) => {
                el.classList.toggle('active', el.dataset.chatBgPreset === 'default');
            });
            showToast(t('messages.bgReset'));
            return;
        }
        if (e.target.closest('#msgChatBgUploadBtn')) {
            const btn = e.target.closest('#msgChatBgUploadBtn');
            const fileInput = document.getElementById('msgChatBgFile');
            if (fileInput && btn) {
                fileInput.dataset.peerId = btn.dataset.peerId || String(openChatPeerId || '');
                fileInput.click();
            }
            return;
        }
        const chatWith = e.target.closest('[data-chat-with]');
        if (chatWith) {
            const userId = Number(chatWith.dataset.chatWith);
            _pendingPeerHint = tabCache.friends.friends?.find((u) => u.id === userId) || null;
            currentTab = 'chats';
            openChatPeerId = userId;
            renderTabs();
            await renderChats();
            return;
        }
        const viewUser = e.target.closest('[data-view-user]');
        if (viewUser && window.openUserProfile) {
            window.openUserProfile(Number(viewUser.dataset.viewUser));
            return;
        }
        const remove = e.target.closest('[data-remove-friend]');
        if (remove) {
            const userId = Number(remove.dataset.removeFriend);
            if (!userId) return;
            if (!window.confirm(t('messages.confirmRemoveFriend'))) return;
            try {
                remove.disabled = true;
                await removeFriend(userId);
                showToast(t('messages.friendRemoved'));
                if (openChatPeerId === userId) {
                    openChatPeerId = null;
                    chatState.peerId = null;
                    currentTab = 'friends';
                    renderTabs();
                }
                await reloadFriendsPreserveSearch();
            } catch (err) {
                showToast(err.message);
                remove.disabled = false;
            }
            return;
        }
        const accept = e.target.closest('[data-accept]');
        if (accept) {
            try {
                accept.disabled = true;
                await acceptFriendRequest(Number(accept.dataset.accept));
                showToast(t('messages.friendAdded'));
                invalidateCache('friends', 'chats', 'interact');
                if (currentTab === 'interact') renderInteract({ force: true });
                else reloadFriendsPreserveSearch({ refetchFriends: currentTab === 'friends' });
                invalidateUnreadCache();
                updateTabBadges();
            } catch (err) {
                showToast(err.message);
                accept.disabled = false;
            }
            return;
        }
        const reject = e.target.closest('[data-reject]');
        if (reject) {
            try {
                reject.disabled = true;
                await rejectFriendRequest(Number(reject.dataset.reject));
                showToast(t('messages.requestRejected'));
                invalidateCache('friends', 'interact');
                if (currentTab === 'interact') renderInteract({ force: true });
                else reloadFriendsPreserveSearch({ refetchFriends: currentTab === 'friends' });
                invalidateUnreadCache();
                updateTabBadges();
            } catch (err) {
                showToast(err.message);
                reject.disabled = false;
            }
            return;
        }
        const add = e.target.closest('[data-add]');
        if (add) {
            try {
                add.disabled = true;
                await sendFriendRequest(Number(add.dataset.add));
                showToast(t('messages.requestSent'));
                invalidateCache('friends');
                const keyword = document.getElementById('msgAddInput')?.value?.trim();
                if (keyword) await searchAndRender(keyword);
                updateTabBadges();
            } catch (err) {
                showToast(err.message);
                add.disabled = false;
            }
            return;
        }
        const cancel = e.target.closest('[data-cancel-request]');
        if (cancel) {
            try {
                cancel.disabled = true;
                await cancelFriendRequest(Number(cancel.dataset.cancelRequest));
                showToast(t('messages.requestCancelled'));
                await reloadFriendsPreserveSearch();
            } catch (err) {
                showToast(err.message);
                cancel.disabled = false;
            }
            return;
        }
        if (e.target.closest('#msgAddBtn')) {
            await searchAndRender(document.getElementById('msgAddInput')?.value || '');
            return;
        }
        const notif = e.target.closest('[data-notif]');
        if (notif) {
            const postId = notif.dataset.post;
            if (postId && window.openPostDetail) {
                window.openPostDetail(Number(postId));
            } else if (notif.dataset.type === 'friend_request') {
                currentTab = 'friends';
                openChatPeerId = null;
                renderTabs();
                await renderFriends({ force: true });
            }
            return;
        }
    });

    page.addEventListener('change', async (e) => {
        if (e.target.id !== 'msgChatBgFile') return;
        const file = e.target.files?.[0];
        e.target.value = '';
        const peerId = Number(e.target.dataset.peerId || openChatPeerId);
        if (!file || !peerId) return;
        try {
            const dataUrl = await compressChatBgImage(file);
            if (!setChatBackground(peerId, { type: 'custom', id: 'custom', dataUrl })) {
                showToast(t('messages.bgSaveFail'));
                return;
            }
            applyChatBackground(document.getElementById('msgChatBody'), peerId);
            document.getElementById('msgChatBgPanel')?.querySelectorAll('.msg-chat-bg-swatch').forEach((el) => {
                el.classList.remove('active');
            });
            showToast(t('messages.bgCustomSaved'));
        } catch (err) {
            showToast(err.message || t('messages.imageFail'));
        }
    });

    page.addEventListener('input', (e) => {
        if (e.target.id === 'msgAddInput') {
            clearTimeout(page._searchTimer);
            page._searchTimer = setTimeout(() => searchAndRender(e.target.value), 300);
        }
    });

    page.addEventListener('keydown', async (e) => {
        if (e.target.id === 'msgAddInput' && e.key === 'Enter') {
            e.preventDefault();
            await searchAndRender(e.target.value || '');
            return;
        }
        const notifItem = e.target.closest?.('[data-notif]');
        if (notifItem && !e.target.closest?.('.msg-mini-btn') && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            notifItem.click();
        }
    });

    page.addEventListener('submit', async (e) => {
        if (e.target.id !== 'msgChatForm') return;
        e.preventDefault();
        const input = document.getElementById('msgChatText');
        const text = input?.value.trim();
        if (!text || !openChatPeerId) return;
        input.value = '';
        enqueueSendChatMessage(text);
    });
}

export function initMessagesPage() {
    bindEvents();
    bindVisibilitySync();
    _seedChatsFromSession();
    renderTabs();

    if (currentTab !== 'chats') return;

    const view = document.getElementById('msgChatsView');
    if (!view) return;

    ensureConvoWrap(view);
    showConvoList();
    if (tabCache.chats.items) {
        paintConvoList(tabCache.chats.items);
    } else {
        const list = document.getElementById('msgConvoList');
        if (list) list.innerHTML = `<div class="msg-skeleton">${t('common.loading')}</div>`;
    }
}

function _prefetchInactiveTabs() {
    const tasks = [];
    if (!isCacheFresh(tabCache.friends.at)) {
        tasks.push(fetchFriendsData().catch(() => {}));
    }
    if (!isCacheFresh(tabCache.interact.at)) {
        tasks.push(fetchNotifications().catch(() => {}));
    }
    return Promise.all(tasks);
}

function _scheduleMessagesPageExtras({ force = false } = {}) {
    clearTimeout(_scheduleMessagesPageExtras._timer);

    const run = async () => {
        await refreshAllBadges(null, { force }).catch(() => {});
        if (!document.getElementById('messagesPage')?.classList.contains('active-page')) return;
        await _prefetchInactiveTabs();
    };

    const schedule = () => { run().catch(() => {}); };

    if (typeof requestIdleCallback === 'function') {
        _scheduleMessagesPageExtras._timer = setTimeout(() => {
            requestIdleCallback(schedule, { timeout: 2500 });
        }, 0);
    } else {
        _scheduleMessagesPageExtras._timer = setTimeout(schedule, 300);
    }
}
_scheduleMessagesPageExtras._timer = null;

export function stopMessagesRealtimeSync() {
    stopRealtimeSync();
}

export function clearMessagesTabBadges() {
    clearTabBadges();
}

if (typeof window !== 'undefined') {
    window.clearMessagesTabBadges = clearMessagesTabBadges;
}

export function setMessagesTab(tabId) {
    currentTab = tabId;
    openChatPeerId = null;
}

/** 从外部打开与某好友的私信 */
export function openChatWith(userId, peerHint = null) {
    currentTab = 'chats';
    openChatPeerId = userId;
    _pendingPeerHint = peerHint;
    renderTabs();
    renderChats();
}

export async function refreshMessages({ force = false } = {}) {
    bindEvents();
    bindVisibilitySync();
    _seedChatsFromSession();
    renderTabs();

    if (currentTab === 'chats') {
        await renderChats({ force });
    } else if (currentTab === 'friends') {
        await renderFriends({ force });
    } else {
        await renderInteract({ force });
    }

    _scheduleMessagesPageExtras({ force });
}

/** 冷启动预取：仅会话列表（私信 Tab 首屏） */
export async function prefetchMessagesEntryData() {
    if (!getAuthToken()) return;
    if (_readSessionConversations()) return;
    try {
        await fetchConversations({ silent: true, useBootstrap: true });
    } catch { /* ignore */ }
}

export function getMessagesState() {
    return { currentTab, openChatPeerId };
}
