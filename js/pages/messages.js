/**
 * 消息中心：私信 + 好友 + 互动通知
 * 优化：Tab 缓存、聊天增量渲染、乐观发送、好友页局部刷新
 */
import { getUser } from '../auth.js';
import {
    listDmConversations,
    getDmMessages,
    sendDmMessage,
    listFriends,
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
} from '../api.js';
import { showToast, escapeHtml, avatarHtmlForUser, formatTimeBrief } from '../utils.js';
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

function invalidateCache(...keys) {
    keys.forEach((key) => {
        if (key === 'chats') tabCache.chats = { items: null, at: 0 };
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
        if (badge) badge.hidden = true;
    }
}

async function refreshAllBadges(preloaded) {
    try {
        const data = preloaded || await getUnreadCounts();
        setTabBadge('chats', data.messages);
        setTabBadge('interact', data.interact ?? 0);
        setTabBadge('friends', data.friend_requests ?? 0);
        if (typeof window.refreshUnreadBadge === 'function') {
            await window.refreshUnreadBadge(data);
        }
    } catch { /* 静默 */ }
}

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
            ${avatarHtmlForUser(c.peer, 48)}
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
    list.innerHTML = convoListHtml(items);
}

async function fetchConversations() {
    const data = await listDmConversations();
    const items = data.items || [];
    tabCache.chats = { items, at: Date.now() };
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
        fetchConversations()
            .then((items) => { paintConvoList(items); updateTabBadges(); startRealtimeSync(); })
            .catch(() => {});
        return;
    }

    try {
        const items = await fetchConversations();
        paintConvoList(items);
        updateTabBadges();
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
    return `
        <div class="msg-bubble-row ${m.is_mine ? 'me' : 'them'}${pendingCls}"${tempAttr}>
            ${m.is_mine ? '' : avatarHtmlForUser(peer, 32)}
            <div class="msg-bubble" style="${style}">${escapeHtml(m.content)}</div>
        </div>`;
}

function paintChatMessages({ scrollToBottom = true } = {}) {
    const body = document.getElementById('msgChatBody');
    if (!body) return;

    const frag = document.createDocumentFragment();

    if (chatState.page > 1) {
        const hint = document.createElement('div');
        hint.className = 'msg-load-hint';
        hint.id = 'msgLoadMoreHint';
        hint.textContent = t('messages.loadOlder');
        frag.appendChild(hint);
    }

    if (!chatState.messages.length) {
        const empty = document.createElement('div');
        empty.className = 'msg-empty-sm';
        empty.textContent = t('messages.startChat');
        frag.appendChild(empty);
    } else {
        chatState.messages.forEach((m) => {
            const wrap = document.createElement('div');
            wrap.innerHTML = bubbleRowHtml(m);
            frag.appendChild(wrap.firstElementChild);
        });
    }

    body.replaceChildren(frag);
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
        if (chatState.loadingMore || chatState.page <= 1) return;
        if (body.scrollTop > 80) return;
        loadOlderMessages();
    });
}

const CHAT_POLL_MS = 2500;
const CONVO_POLL_MS = 6000;

let _syncTimer = null;
let _syncMode = null;
let _syncInFlight = false;
let _visibilityBound = false;

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

function stopRealtimeSync() {
    if (_syncTimer) clearInterval(_syncTimer);
    _syncTimer = null;
    _syncMode = null;
}

function startRealtimeSync() {
    stopRealtimeSync();
    if (!getUser()) return;
    const onMessagesPage = document.getElementById('messagesPage')?.classList.contains('active-page');
    if (!onMessagesPage || document.hidden) return;

    if (openChatPeerId && chatState.peerId) {
        _syncMode = 'chat';
        void pollChatOnce();
        _syncTimer = setInterval(pollChatOnce, CHAT_POLL_MS);
    } else if (currentTab === 'chats') {
        _syncMode = 'convo';
        void pollConvoOnce();
        _syncTimer = setInterval(pollConvoOnce, CONVO_POLL_MS);
    }
}

async function pollChatOnce() {
    if (_syncInFlight || document.hidden || _syncMode !== 'chat') return;
    const peerId = openChatPeerId || chatState.peerId;
    if (!peerId || !chatState.messages.length) return;

    const afterId = getLastConfirmedMessageId();
    if (afterId <= 0) return;

    _syncInFlight = true;
    try {
        const data = await getDmMessages(peerId, { after_id: afterId }, true);
        const body = document.getElementById('msgChatBody');
        const stickBottom = isChatNearBottom(body);

        const incoming = (data.items || []).filter(
            (m) => m.id && !chatState.messages.some((x) => x.id === m.id),
        );
        if (!incoming.length) return;

        for (const m of incoming) {
            chatState.messages.push(m);
            appendChatBubble(m, { scroll: false });
            if (!m.is_mine) {
                bumpLocalConvoPreview(peerId, m.content);
            }
        }
        if (stickBottom && body) body.scrollTop = body.scrollHeight;
        refreshAllBadges();
    } catch { /* 静默 */ } finally {
        _syncInFlight = false;
    }
}

async function pollConvoOnce() {
    if (_syncInFlight || document.hidden || _syncMode !== 'convo' || openChatPeerId) return;
    _syncInFlight = true;
    try {
        const items = await fetchConversations();
        paintConvoList(items);
        refreshAllBadges();
    } catch { /* 静默 */ } finally {
        _syncInFlight = false;
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
    const total = data.total || 0;
    const peer = data.peer || { id: peerId, username: t('messages.user') };
    const messages = data.items || [];
    const page = data.page || Math.max(1, Math.ceil(total / CHAT_PAGE_SIZE));
    return { peer, messages, page, total };
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

    const body = document.getElementById('msgChatBody');
    if (body) body.innerHTML = `<div class="msg-skeleton">${t('common.loading')}</div>`;

    try {
        const cachedPeer = peerHint
            || _pendingPeerHint
            || tabCache.chats.items?.find((c) => c.peer_id === peerId)?.peer;
        _pendingPeerHint = null;
        const { peer, messages, page, total } = await fetchChatThread(peerId);
        chatState.peer = cachedPeer || peer;
        chatState.messages = messages;
        chatState.page = page;
        chatState.total = total;
        syncBubbleStyles();
        updateChatHeader();
        paintChatMessages({ scrollToBottom: true });
        document.getElementById('msgChatText')?.focus();
        invalidateCache('chats');
        fetchConversations().catch(() => {});
        refreshAllBadges();
        startRealtimeSync();
    } catch (e) {
        if (body) body.innerHTML = `<div class="msg-empty-sm">${escapeHtml(e.message || t('messages.chatLoadFail'))}</div>`;
    }
}

async function loadOlderMessages() {
    if (chatState.loadingMore || chatState.page <= 1 || !chatState.peerId) return;
    chatState.loadingMore = true;
    const body = document.getElementById('msgChatBody');
    const prevHeight = body?.scrollHeight || 0;

    try {
        const prevPage = chatState.page - 1;
        const data = await getDmMessages(chatState.peerId, { page: prevPage, page_size: CHAT_PAGE_SIZE });
        const older = data.items || [];
        if (older.length) {
            chatState.messages = [...older, ...chatState.messages];
            chatState.page = prevPage;
            paintChatMessages({ scrollToBottom: false });
            if (body) body.scrollTop = body.scrollHeight - prevHeight;
        }
    } catch { /* 静默 */ }
    chatState.loadingMore = false;
}

function appendChatBubble(message, { pending = false, scroll = true } = {}) {
    const body = document.getElementById('msgChatBody');
    if (!body) return;

    const empty = body.querySelector('.msg-empty-sm');
    if (empty) empty.remove();

    const row = document.createElement('div');
    row.innerHTML = bubbleRowHtml(message, { pending });
    body.appendChild(row.firstElementChild);
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
    };

    appendChatBubble(optimistic, { pending: true });
    bumpLocalConvoPreview(peerId, text);

    _sendQueue = _sendQueue
        .then(() => sendChatMessageOnce(peerId, tempId, text))
        .catch(() => {});
}

async function sendChatMessageOnce(peerId, tempId, text) {
    try {
        const saved = await sendDmMessage(peerId, text);
        const row = document.querySelector(`[data-temp-id="${tempId}"]`);
        if (row) {
            row.classList.remove('is-pending');
            row.removeAttribute('data-temp-id');
        }
        chatState.messages.push({
            id: saved.id,
            sender_id: saved.sender_id,
            content: saved.content,
            is_mine: true,
            created_at: saved.created_at,
        });
        scheduleConvoListSync();
    } catch (err) {
        document.querySelector(`[data-temp-id="${tempId}"]`)?.remove();
        showToast(err.message || t('messages.sendFail'));
    }
}

// ── 好友页 ────────────────────────────────────────────────────

function friendRequestRowHtml(r) {
    return `
        <div class="msg-friend-item" data-request-id="${r.id}">
            ${avatarHtmlForUser(r.requester, 44)}
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
            ${avatarHtmlForUser(r.addressee, 44)}
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
            ${avatarHtmlForUser(u, 44)}
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
            ${avatarHtmlForUser(u, 40)}
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

async function reloadFriendsPreserveSearch() {
    const input = document.getElementById('msgAddInput');
    const keyword = input?.value?.trim() || '';
    const selStart = input?.selectionStart;
    const selEnd = input?.selectionEnd;

    invalidateCache('friends');
    try {
        const data = await fetchFriendsData();
        paintFriendsData(data);
        updateTabBadges();
    } catch {
        showToast(t('messages.loadFail'));
    }

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
            ${avatarHtmlForUser(n.actor, 40)}
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
            .then(async (items) => {
                view.innerHTML = items.length
                    ? `<div class="msg-notif-list">${notifListHtml(items)}</div>`
                    : `<div class="msg-empty"><i class="fas fa-bell"></i><p>${t('messages.noInteract')}</p></div>`;
                await markNotificationsRead(null, { excludeTypes: ['friend_request'] });
                refreshAllBadges();
            })
            .catch(() => {});
        return;
    }

    try {
        const items = await fetchNotifications();
        view.innerHTML = items.length
            ? `<div class="msg-notif-list">${notifListHtml(items)}</div>`
            : `<div class="msg-empty"><i class="fas fa-bell"></i><p>${t('messages.noInteract')}</p></div>`;
        await markNotificationsRead(null, { excludeTypes: ['friend_request'] });
        refreshAllBadges();
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
                if (currentTab === 'interact') await renderInteract({ force: true });
                else await reloadFriendsPreserveSearch();
                refreshAllBadges();
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
                if (currentTab === 'interact') await renderInteract({ force: true });
                else await reloadFriendsPreserveSearch();
                refreshAllBadges();
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
                await reloadFriendsPreserveSearch();
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
}

export function stopMessagesRealtimeSync() {
    stopRealtimeSync();
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
    renderTabs();
    updateTabBadges();
    if (currentTab === 'chats') await renderChats({ force });
    else if (currentTab === 'friends') await renderFriends({ force });
    else await renderInteract({ force });
    startRealtimeSync();
}

export function getMessagesState() {
    return { currentTab, openChatPeerId };
}
