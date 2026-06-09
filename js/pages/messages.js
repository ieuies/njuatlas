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
import { DEFAULT_BUBBLE_STYLE, bubbleThemeCssVars, normalizeBubbleStyle } from '../bubbleThemes.js';

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
    const name = n.actor?.username || '有人';
    switch (n.type) {
        case 'like': return `${name} 赞了你的帖子`;
        case 'comment': return `${name} 评论了你的帖子`;
        case 'friend_request': return `${name} 请求加你为好友`;
        case 'friend_accept': return `${name} 接受了你的好友请求`;
        default: return `${name} 与你互动了`;
    }
}

function notifActionHtml(n) {
    if (n.type !== 'friend_request' || !n.friendship_id) return '';
    return `
        <div class="msg-notif-actions">
            <button class="msg-mini-btn primary" data-accept="${n.friendship_id}" type="button">接受</button>
            <button class="msg-mini-btn" data-reject="${n.friendship_id}" type="button">拒绝</button>
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
            view.innerHTML = `<div class="msg-empty"><i class="fas fa-comments"></i><p>还没有私信，加好友后就可以聊天了</p></div>`;
            return;
        }
        view.innerHTML = `<div class="msg-convo-list">${items.map((c) => `
            <button class="msg-convo-item" data-chat="${c.peer_id}" type="button">
                ${avatarHtmlForUser(c.peer, 48)}
                <div class="msg-convo-main">
                    <div class="msg-convo-top">
                        <span class="msg-convo-name">${escapeHtml(c.peer?.username || '用户')}</span>
                        <span class="msg-convo-time">${fmtTime(c.last_at)}</span>
                    </div>
                    <div class="msg-convo-preview">${escapeHtml(c.last_message || '')}${c.unread_count ? ` <span class="msg-unread-dot">${c.unread_count}</span>` : ''}</div>
                </div>
            </button>`).join('')}</div>`;
    } catch (e) {
        view.innerHTML = `<div class="msg-empty-sm">加载失败，请稍后重试</div>`;
    }
}

async function renderChatRoom(view, peerId) {
    let peer = { id: peerId, username: '用户' };
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
                    <span class="msg-chat-title">${escapeHtml(peer.username || '用户')}</span>
                </div>
                <div class="msg-chat-body" id="msgChatBody">${bubbles || '<div class="msg-empty-sm">发条消息开始聊天</div>'}</div>
                <form class="msg-chat-input" id="msgChatForm">
                    <input type="text" id="msgChatText" placeholder="输入消息…" autocomplete="off" maxlength="500">
                    <button type="submit" class="msg-send-btn"><i class="fas fa-paper-plane"></i></button>
                </form>
            </div>`;
        const body = document.getElementById('msgChatBody');
        if (body) body.scrollTop = body.scrollHeight;
    } catch (e) {
        view.innerHTML = `<div class="msg-empty-sm">${escapeHtml(e.message || '无法加载聊天')}</div>`;
    }
}

async function renderFriends() {
    const view = document.getElementById('msgFriendsView');
    if (!view) return;
    view.innerHTML = '<div class="profile-loading">加载中...</div>';
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
                    <span class="msg-friend-bio">${escapeHtml(r.requester?.campus ? r.requester.campus + '校区' : '请求加你为好友')}</span>
                </div>
                <div class="msg-friend-actions">
                    <button class="msg-mini-btn primary" data-accept="${r.id}" type="button">接受</button>
                    <button class="msg-mini-btn" data-reject="${r.id}" type="button">拒绝</button>
                </div>
            </div>`).join('');

        const sentRows = sentRequests.map((r) => `
            <div class="msg-friend-item">
                ${avatarHtmlForUser(r.addressee, 44)}
                <div class="msg-friend-main">
                    <span class="msg-friend-name">${escapeHtml(r.addressee?.username || '')}</span>
                    <span class="msg-friend-bio">${escapeHtml(r.addressee?.campus ? r.addressee.campus + '校区' : '等待对方处理')}</span>
                </div>
                <div class="msg-friend-actions">
                    <button class="msg-mini-btn" data-cancel-request="${r.id}" type="button">撤回</button>
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
                    <button class="msg-mini-btn primary" data-chat-with="${u.id}" type="button"><i class="fas fa-comment"></i> 发消息</button>
                    <button class="msg-mini-btn" data-view-user="${u.id}" type="button">主页</button>
                    <button class="msg-mini-btn danger" data-remove-friend="${u.id}" type="button">删除好友</button>
                </div>
            </div>`).join('') : `<div class="msg-empty-sm">还没有好友，搜索添加吧</div>`;

        view.innerHTML = `
            <div class="msg-add-row">
                <input type="text" id="msgAddInput" placeholder="搜索用户名添加好友…" autocomplete="off">
                <button class="msg-mini-btn primary" id="msgAddBtn" type="button"><i class="fas fa-user-plus"></i> 添加</button>
            </div>
            <div id="msgAddResults" class="msg-add-results"></div>
            ${sentRequests.length ? `<h4 class="msg-section-title">我发出的请求 (${sentRequests.length})</h4>${sentRows}` : ''}
            ${requests.length ? `<h4 class="msg-section-title">新的好友请求 (${requests.length})</h4>${requestRows}` : ''}
            <h4 class="msg-section-title">我的好友 (${friends.length})</h4>
            ${friendRows}`;
    } catch (e) {
        view.innerHTML = `<div class="msg-empty-sm">加载失败</div>`;
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
            view.innerHTML = `<div class="msg-empty-sm">没有找到「${escapeHtml(key)}」</div>`;
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
                            <button class="msg-mini-btn primary" data-chat-with="${u.id}" type="button"><i class="fas fa-comment"></i> 发消息</button>
                            <button class="msg-mini-btn" data-view-user="${u.id}" type="button">主页</button>
                            <button class="msg-mini-btn danger" data-remove-friend="${u.id}" type="button">删除好友</button>
                        </div>`
                    : u.friendship_status === 'pending_sent' && u.friendship_request_id ? `
                        <div class="msg-friend-actions">
                            <span class="msg-tag-pending">已申请</span>
                            <button class="msg-mini-btn" data-cancel-request="${u.friendship_request_id}" type="button">撤回</button>
                        </div>`
                    : u.friendship_status === 'pending_sent' ? '<span class="msg-tag-pending">已申请</span>'
                    : u.friendship_status === 'pending_received' && u.friendship_request_id ? `
                        <div class="msg-friend-actions">
                            <button class="msg-mini-btn primary" data-accept="${u.friendship_request_id}" type="button">接受</button>
                            <button class="msg-mini-btn" data-reject="${u.friendship_request_id}" type="button">拒绝</button>
                        </div>`
                    : u.friendship_status === 'pending_received' ? '<span class="msg-tag-pending">待你处理</span>'
                    : `<button class="msg-mini-btn primary" data-add="${u.id}" type="button">加好友</button>`}
            </div>`).join('');
    } catch (e) {
        view.innerHTML = `<div class="msg-empty-sm">搜索失败</div>`;
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

function setNotifFriendRequestHandled(notifItem, text) {
    if (!notifItem) return;
    notifItem.classList.remove('unread');
    notifItem.dataset.friendRequestHandled = '1';
    const actions = notifItem.querySelector('.msg-notif-actions');
    if (actions) {
        actions.innerHTML = `<span class="msg-notif-handled">${text}</span>`;
    }
}

function toggleNotifActionButtons(notifItem, disabled) {
    if (!notifItem) return;
    notifItem.querySelectorAll('.msg-notif-actions .msg-mini-btn').forEach((btn) => {
        btn.disabled = disabled;
    });
}

async function renderInteract() {
    const view = document.getElementById('msgInteractView');
    if (!view) return;
    view.innerHTML = '<div class="profile-loading">加载中...</div>';
    try {
        const data = await listNotifications();
        const items = data.items || [];
        if (!items.length) {
            view.innerHTML = `<div class="msg-empty"><i class="fas fa-bell"></i><p>暂无互动通知</p></div>`;
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
        view.innerHTML = `<div class="msg-empty-sm">加载失败</div>`;
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
            if (!window.confirm('确认删除该好友吗？删除后将无法继续私信。')) return;
            try {
                remove.disabled = true;
                await removeFriend(userId);
                showToast('已删除好友');
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
            const notifItem = accept.closest('[data-notif]');
            try {
                if (notifItem) toggleNotifActionButtons(notifItem, true);
                else accept.disabled = true;
                await acceptFriendRequest(Number(accept.dataset.accept));
                showToast('已添加好友');
                if (notifItem) {
                    setNotifFriendRequestHandled(notifItem, '已接受');
                } else {
                    await refreshFriendsWithSearch();
                }
            } catch (err) {
                showToast(err.message);
                if (notifItem) toggleNotifActionButtons(notifItem, false);
                else accept.disabled = false;
            }
            return;
        }
        const reject = e.target.closest('[data-reject]');
        if (reject) {
            const notifItem = reject.closest('[data-notif]');
            try {
                if (notifItem) toggleNotifActionButtons(notifItem, true);
                else reject.disabled = true;
                await rejectFriendRequest(Number(reject.dataset.reject));
                showToast('已拒绝好友请求');
                if (notifItem) {
                    setNotifFriendRequestHandled(notifItem, '已拒绝');
                } else {
                    await refreshFriendsWithSearch();
                }
            } catch (err) {
                showToast(err.message);
                if (notifItem) toggleNotifActionButtons(notifItem, false);
                else reject.disabled = false;
            }
            return;
        }
        const add = e.target.closest('[data-add]');
        if (add) {
            try {
                add.disabled = true;
                await sendFriendRequest(Number(add.dataset.add));
                showToast('好友请求已发送');
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
                showToast('已撤回好友申请');
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
            } else if (notif.dataset.type === 'friend_request' && notif.dataset.friendRequestHandled !== '1') {
                currentTab = 'friends';
                openChatPeerId = null;
                renderTabs();
                await renderFriends();
            }
            return;
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
            showToast(err.message || '发送失败');
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
