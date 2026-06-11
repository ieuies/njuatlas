/**
 * 消息中心：私信 + 好友 + 互动通知（接真实后端 API）
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

let currentTab = 'chats';
let openChatPeerId = null;
let _bound = false;

function fmtTime(iso) {
    return formatTimeBrief(iso);
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

function renderTabs() {
    document.querySelectorAll('#messagesPage .msg-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.tab === currentTab);
    });
    ['msgChatsView', 'msgFriendsView', 'msgInteractView'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const map = { chats: 'msgChatsView', friends: 'msgFriendsView', interact: 'msgInteractView' };
    const view = document.getElementById(map[currentTab]);
    if (view) view.style.display = 'block';
}

async function renderChats() {
    const view = document.getElementById('msgChatsView');
    if (!view) return;

    if (openChatPeerId) {
        await renderChatRoom(view, openChatPeerId);
        return;
    }

    try {
        const data = await listDmConversations();
        const items = data.items || [];
        if (!items.length) {
            view.innerHTML = `<div class="msg-empty"><i class="fas fa-comments"></i><p>${t('messages.noChats')}</p></div>`;
            return;
        }
        view.innerHTML = `<div class="msg-convo-list">${items.map((c) => `
            <button class="msg-convo-item" data-chat="${c.peer_id}" type="button">
                ${avatarHtmlForUser(c.peer, 48)}
                <div class="msg-convo-main">
                    <div class="msg-convo-top">
                        <span class="msg-convo-name">${escapeHtml(c.peer?.username || t('messages.user'))}</span>
                        <span class="msg-convo-time">${fmtTime(c.last_at)}</span>
                    </div>
                    <div class="msg-convo-preview">${escapeHtml(c.last_message || '')}${c.unread_count ? ` <span class="msg-unread-dot">${c.unread_count}</span>` : ''}</div>
                </div>
            </button>`).join('')}</div>`;
    } catch (e) {
        view.innerHTML = `<div class="msg-empty-sm">${t('messages.loadFail')}</div>`;
    }
}

async function renderChatRoom(view, peerId) {
    let peer = { id: peerId, username: t('messages.user') };
    try {
        const data = await getDmMessages(peerId);
        const msgs = data.items || [];
        const conv = (await listDmConversations()).items?.find((c) => c.peer_id === peerId);
        if (conv?.peer) peer = conv.peer;
        const me = getUser();
        const myUserId = me?.id;
        const myBubbleStyle = normalizeBubbleStyle(me?.bubble_style || DEFAULT_BUBBLE_STYLE);
        const peerBubbleStyle = normalizeBubbleStyle(peer?.bubble_style || DEFAULT_BUBBLE_STYLE);

        const bubbles = msgs.map((m) => `
            <div class="msg-bubble-row ${m.is_mine ? 'me' : 'them'}">
                ${m.is_mine ? '' : avatarHtmlForUser(peer, 32)}
                <div class="msg-bubble" style="${bubbleThemeCssVars(resolveSenderBubbleStyle(m.sender_id, myUserId, myBubbleStyle, peerBubbleStyle))}">${escapeHtml(m.content)}</div>
            </div>`).join('');

        view.innerHTML = `
            <div class="msg-chatroom">
                <div class="msg-chat-header">
                    <button class="msg-back-btn" id="msgBackBtn" type="button"><i class="fas fa-arrow-left"></i></button>
                    ${avatarHtmlForUser(peer, 36)}
                    <span class="msg-chat-title">${escapeHtml(peer.username || t('messages.user'))}</span>
                    <button class="msg-chat-bg-btn" id="msgChatBgBtn" type="button" aria-label="${t('messages.chatBgBtn')}" title="${t('messages.chatBg')}">
                        <i class="fas fa-image"></i>
                    </button>
                </div>
                <div class="msg-chat-body" id="msgChatBody" data-peer-id="${peerId}">${bubbles || `<div class="msg-empty-sm">${t('messages.startChat')}</div>`}</div>
                <form class="msg-chat-input" id="msgChatForm">
                    <input type="text" id="msgChatText" placeholder="${t('messages.chatPlaceholder')}" autocomplete="off" maxlength="500">
                    <button type="submit" class="msg-send-btn"><i class="fas fa-paper-plane"></i></button>
                </form>
                ${buildChatBgPanelHtml(peerId)}
            </div>`;
        const body = document.getElementById('msgChatBody');
        applyChatBackground(body, peerId);
        if (body) body.scrollTop = body.scrollHeight;
    } catch (e) {
        view.innerHTML = `<div class="msg-empty-sm">${escapeHtml(e.message || t('messages.chatLoadFail'))}</div>`;
    }
}

async function renderFriends() {
    const view = document.getElementById('msgFriendsView');
    if (!view) return;
    view.innerHTML = `<div class="profile-loading">${t('common.loading')}</div>`;
    try {
        const [friendsData, reqData, sentReqData] = await Promise.all([
            listFriends(),
            listFriendRequests(),
            listSentFriendRequests(),
        ]);
        const friends = friendsData.items || [];
        const requests = reqData.items || [];
        const sentRequests = sentReqData.items || [];

        const requestRows = requests.map((r) => `
            <div class="msg-friend-item">
                ${avatarHtmlForUser(r.requester, 44)}
                <div class="msg-friend-main">
                    <span class="msg-friend-name">${escapeHtml(r.requester?.username || '')}</span>
                    <span class="msg-friend-bio">${escapeHtml(r.requester?.campus ? campusLabel(r.requester.campus) : t('messages.friendRequestBio'))}</span>
                </div>
                <div class="msg-friend-actions">
                    <button class="msg-mini-btn primary" data-accept="${r.id}" type="button">${t('messages.accept')}</button>
                    <button class="msg-mini-btn" data-reject="${r.id}" type="button">${t('messages.reject')}</button>
                </div>
            </div>`).join('');

        const sentRows = sentRequests.map((r) => `
            <div class="msg-friend-item">
                ${avatarHtmlForUser(r.addressee, 44)}
                <div class="msg-friend-main">
                    <span class="msg-friend-name">${escapeHtml(r.addressee?.username || '')}</span>
                    <span class="msg-friend-bio">${escapeHtml(r.addressee?.campus ? campusLabel(r.addressee.campus) : t('messages.waitPending'))}</span>
                </div>
                <div class="msg-friend-actions">
                    <button class="msg-mini-btn" data-cancel-request="${r.id}" type="button">${t('messages.cancelRequest')}</button>
                </div>
            </div>`).join('');

        const friendRows = friends.length ? friends.map((u) => `
            <div class="msg-friend-item">
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
            </div>`).join('') : `<div class="msg-empty-sm">${t('messages.noFriends')}</div>`;

        view.innerHTML = `
            <div class="msg-add-row">
                <input type="text" id="msgAddInput" placeholder="${t('messages.searchFriend')}" autocomplete="off">
                <button class="msg-mini-btn primary" id="msgAddBtn" type="button"><i class="fas fa-user-plus"></i> ${t('messages.addFriend')}</button>
            </div>
            <div id="msgAddResults" class="msg-add-results"></div>
            ${sentRequests.length ? `<h4 class="msg-section-title">${t('messages.sectionSent', { n: sentRequests.length })}</h4>${sentRows}` : ''}
            ${requests.length ? `<h4 class="msg-section-title">${t('messages.sectionNew', { n: requests.length })}</h4>${requestRows}` : ''}
            <h4 class="msg-section-title">${t('messages.sectionFriends', { n: friends.length })}</h4>
            ${friendRows}`;
    } catch (e) {
        view.innerHTML = `<div class="msg-empty-sm">${t('messages.loadFail')}</div>`;
    }
}

async function searchAndRender(q) {
    const view = document.getElementById('msgAddResults');
    if (!view) return;
    const key = q.trim();
    if (!key) { view.innerHTML = ''; return; }
    try {
        const data = await searchUsers(key);
        const hits = data.items || [];
        if (!hits.length) {
            view.innerHTML = `<div class="msg-empty-sm">${t('messages.notFound', { key: escapeHtml(key) })}</div>`;
            return;
        }
        view.innerHTML = hits.map((u) => `
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
            </div>`).join('');
    } catch (e) {
        view.innerHTML = `<div class="msg-empty-sm">${t('messages.searchFail')}</div>`;
    }
}

async function refreshFriendsWithSearch() {
    const keyword = document.getElementById('msgAddInput')?.value?.trim() || '';
    await renderFriends();
    if (!keyword) return;
    const input = document.getElementById('msgAddInput');
    if (input) input.value = keyword;
    await searchAndRender(keyword);
}

async function renderInteract() {
    const view = document.getElementById('msgInteractView');
    if (!view) return;
    view.innerHTML = `<div class="profile-loading">${t('common.loading')}</div>`;
    try {
        const data = await listNotifications();
        const items = data.items || [];
        if (!items.length) {
            view.innerHTML = `<div class="msg-empty"><i class="fas fa-bell"></i><p>${t('messages.noInteract')}</p></div>`;
            return;
        }
        view.innerHTML = `<div class="msg-notif-list">${items.map((n) => `
            <div class="msg-notif-item ${n.is_read ? '' : 'unread'}" data-notif="${n.id}" data-type="${n.type}" data-post="${n.post_id || ''}" data-friendship="${n.friendship_id || ''}" role="button" tabindex="0">
                ${avatarHtmlForUser(n.actor, 40)}
                <div class="msg-notif-main">
                    <div class="msg-notif-text">${escapeHtml(notifText(n))}</div>
                    ${n.post_title ? `<div class="msg-notif-sub">${escapeHtml(n.post_title)}</div>` : ''}
                    <div class="msg-notif-time">${fmtTime(n.created_at)}</div>
                    ${notifActionHtml(n)}
                </div>
            </div>`).join('')}</div>`;
        await markNotificationsRead();
        if (typeof window.refreshUnreadBadge === 'function') window.refreshUnreadBadge();
    } catch (e) {
        view.innerHTML = `<div class="msg-empty-sm">${t('messages.loadFail')}</div>`;
    }
}

function bindEvents() {
    if (_bound) return;
    _bound = true;
    const page = document.getElementById('messagesPage');
    if (!page) return;

    page.querySelectorAll('.msg-tab').forEach((t) => {
        t.addEventListener('click', async () => {
            currentTab = t.dataset.tab;
            openChatPeerId = null;
            renderTabs();
            if (currentTab === 'chats') await renderChats();
            else if (currentTab === 'friends') await renderFriends();
            else await renderInteract();
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
            await renderChats();
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
            if (presetId === 'default') {
                clearChatBackground(peerId);
            } else {
                setChatBackground(peerId, { type: 'preset', id: presetId });
            }
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
            currentTab = 'chats';
            openChatPeerId = Number(chatWith.dataset.chatWith);
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
                    currentTab = 'friends';
                    renderTabs();
                }
                await refreshFriendsWithSearch();
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
                if (currentTab === 'interact') await renderInteract();
                else await refreshFriendsWithSearch();
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
                if (currentTab === 'interact') await renderInteract();
                else await refreshFriendsWithSearch();
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
                await refreshFriendsWithSearch();
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
                await refreshFriendsWithSearch();
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
                await renderFriends();
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
        try {
            await sendDmMessage(openChatPeerId, text);
            await renderChats();
        } catch (err) {
            showToast(err.message || t('messages.sendFail'));
        }
    });
}

export function initMessagesPage() {
    bindEvents();
}

export function setMessagesTab(tabId) {
    currentTab = tabId;
    openChatPeerId = null;
}

/** 从外部打开与某好友的私信 */
export function openChatWith(userId) {
    currentTab = 'chats';
    openChatPeerId = userId;
    renderTabs();
    renderChats();
}

export async function refreshMessages() {
    bindEvents();
    renderTabs();
    if (currentTab === 'chats') await renderChats();
    else if (currentTab === 'friends') await renderFriends();
    else await renderInteract();
}

export function getMessagesState() {
    return { currentTab, openChatPeerId };
}
