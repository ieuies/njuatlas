/**
 * 消息中心（雏形）：好友 + 私聊
 *
 * 说明：当前后端尚无「好友 / 私信」相关接口，因此本模块先用 mock 数据 +
 * localStorage 搭出完整可交互的前端雏形，便于后续直接替换为真实 API：
 *   - 好友：列表、搜索添加、收到的好友请求（接受/拒绝）
 *   - 私聊：会话列表、聊天气泡、发送消息（带一条模拟回复）
 *
 * 所有数据按当前用户 ID 隔离存储，键名前缀见下方常量。后续接入后端时，
 * 只需把 readState / writeState / sendMessage 等几处替换为接口调用即可。
 */

import { getUser } from '../auth.js';
import { showToast, escapeHtml } from '../utils.js';

// ── 存储键（按用户隔离）─────────────────────────────────────────
function uid() {
    const u = getUser();
    return u && u.id != null ? String(u.id) : 'guest';
}
const KEY = {
    friends: () => `msg_friends_${uid()}`,
    requests: () => `msg_requests_${uid()}`,
    convos: () => `msg_convos_${uid()}`,
    seeded: () => `msg_seeded_${uid()}`,
};

// ── 演示用「其他用户」目录（搜索添加好友时的可选对象）──────────────
const DIRECTORY = [
    { id: 'u_qing', name: '林清', bio: '仙林 · 摄影 & citywalk' },
    { id: 'u_zhou', name: '周屿', bio: '鼓楼 · 篮球搭子常驻' },
    { id: 'u_yan', name: '言叶', bio: '苏州 · 自习 & 咖啡' },
    { id: 'u_mu', name: '沐之', bio: '浦口 · 剧本杀 / 桌游' },
    { id: 'u_he', name: '何川', bio: '鼓楼 · 乐队鼓手' },
    { id: 'u_su', name: '苏苑', bio: '仙林 · 烘焙爱好者' },
];
const DIR_MAP = Object.fromEntries(DIRECTORY.map((u) => [u.id, u]));

// ── 状态读写 ────────────────────────────────────────────────────
function readState(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}
function writeState(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.warn('消息数据写入失败：', e?.message);
    }
}

function getFriends() { return readState(KEY.friends(), []); }
function getRequests() { return readState(KEY.requests(), []); }
function getConvos() { return readState(KEY.convos(), {}); }

// 首次进入时灌入一点演示数据，让雏形「活」起来
function seedOnce() {
    if (localStorage.getItem(KEY.seeded())) return;
    writeState(KEY.friends(), ['u_qing', 'u_zhou']);
    writeState(KEY.requests(), ['u_yan']);
    const now = Date.now();
    writeState(KEY.convos(), {
        u_qing: [
            { from: 'u_qing', text: '明天下午去美术馆 citywalk 吗？', ts: now - 3600_000 },
            { from: 'me', text: '可以啊，几点集合？', ts: now - 3500_000 },
            { from: 'u_qing', text: '两点地铁口见～', ts: now - 3400_000 },
        ],
        u_zhou: [
            { from: 'u_zhou', text: '周末球场约满了，来不来', ts: now - 86400_000 },
        ],
    });
    localStorage.setItem(KEY.seeded(), '1');
}

// ── 头像（mock 用户用首字母色块，与全站风格一致）──────────────────
function dirName(id) { return DIR_MAP[id]?.name || id; }
function avatarHtml(id, size = 44) {
    const name = dirName(id);
    const initial = (name.charAt(0) || '?').toUpperCase();
    const hue = [...name].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
    return `<span class="msg-avatar" style="width:${size}px;height:${size}px;background:hsl(${hue},55%,55%);font-size:${size * 0.4}px;">${escapeHtml(initial)}</span>`;
}

function fmtTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    if (sameDay) return `${hh}:${mm}`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ── 当前视图状态 ───────────────────────────────────────────────
let currentTab = 'chats';     // chats | friends
let openChatId = null;        // 正在聊天的好友 id；null 表示停留在会话列表

// ============================================================
// 渲染：Tab 切换
// ============================================================
function renderTabs() {
    document.querySelectorAll('#messagesPage .msg-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.tab === currentTab);
    });
    const chatsView = document.getElementById('msgChatsView');
    const friendsView = document.getElementById('msgFriendsView');
    if (chatsView) chatsView.style.display = currentTab === 'chats' ? 'block' : 'none';
    if (friendsView) friendsView.style.display = currentTab === 'friends' ? 'block' : 'none';
}

// ============================================================
// 渲染：会话列表 / 聊天界面
// ============================================================
function renderChats() {
    const view = document.getElementById('msgChatsView');
    if (!view) return;

    if (openChatId) {
        renderChatRoom(view, openChatId);
        return;
    }

    const convos = getConvos();
    const friends = getFriends();
    // 会话来源：有聊天记录的，或好友（无记录则显示「开始聊天」）
    const ids = Array.from(new Set([...Object.keys(convos), ...friends]));
    if (!ids.length) {
        view.innerHTML = `<div class="msg-empty"><i class="fas fa-comments"></i><p>还没有会话，去「好友」里找人聊聊吧</p></div>`;
        return;
    }
    const rows = ids.map((id) => {
        const msgs = convos[id] || [];
        const last = msgs[msgs.length - 1];
        const preview = last ? (last.from === 'me' ? '我：' : '') + last.text : '打个招呼吧～';
        const time = last ? fmtTime(last.ts) : '';
        return `
            <button class="msg-convo-item" data-chat="${id}" type="button">
                ${avatarHtml(id, 48)}
                <div class="msg-convo-main">
                    <div class="msg-convo-top">
                        <span class="msg-convo-name">${escapeHtml(dirName(id))}</span>
                        <span class="msg-convo-time">${time}</span>
                    </div>
                    <div class="msg-convo-preview">${escapeHtml(preview)}</div>
                </div>
            </button>`;
    }).join('');
    view.innerHTML = `<div class="msg-convo-list">${rows}</div>`;
}

function renderChatRoom(view, friendId) {
    const convos = getConvos();
    const msgs = convos[friendId] || [];
    const bubbles = msgs.map((m) => `
        <div class="msg-bubble-row ${m.from === 'me' ? 'me' : 'them'}">
            ${m.from === 'me' ? '' : avatarHtml(friendId, 32)}
            <div class="msg-bubble">${escapeHtml(m.text)}</div>
        </div>`).join('');

    view.innerHTML = `
        <div class="msg-chatroom">
            <div class="msg-chat-header">
                <button class="msg-back-btn" id="msgBackBtn" type="button"><i class="fas fa-arrow-left"></i></button>
                ${avatarHtml(friendId, 36)}
                <span class="msg-chat-title">${escapeHtml(dirName(friendId))}</span>
            </div>
            <div class="msg-chat-body" id="msgChatBody">${bubbles || '<div class="msg-empty-sm">发条消息开始聊天</div>'}</div>
            <form class="msg-chat-input" id="msgChatForm">
                <input type="text" id="msgChatText" placeholder="输入消息…" autocomplete="off" maxlength="500">
                <button type="submit" class="msg-send-btn"><i class="fas fa-paper-plane"></i></button>
            </form>
        </div>`;

    const body = document.getElementById('msgChatBody');
    if (body) body.scrollTop = body.scrollHeight;
}

function sendMessage(friendId, text) {
    const convos = getConvos();
    const list = convos[friendId] || [];
    list.push({ from: 'me', text, ts: Date.now() });
    convos[friendId] = list;
    writeState(KEY.convos(), convos);
    renderChats();
    // 雏形：模拟对方稍后回一句，让交互更真实（接入后端后删除）
    setTimeout(() => {
        if (openChatId !== friendId) return;
        const cv = getConvos();
        const l = cv[friendId] || [];
        l.push({ from: friendId, text: '收到～（这是雏形的自动回复）', ts: Date.now() });
        cv[friendId] = l;
        writeState(KEY.convos(), cv);
        if (currentTab === 'chats' && openChatId === friendId) renderChats();
    }, 900);
}

// ============================================================
// 渲染：好友（请求 + 列表 + 添加）
// ============================================================
function renderFriends() {
    const view = document.getElementById('msgFriendsView');
    if (!view) return;
    const friends = getFriends();
    const requests = getRequests();

    const requestRows = requests.map((id) => `
        <div class="msg-friend-item">
            ${avatarHtml(id, 44)}
            <div class="msg-friend-main">
                <span class="msg-friend-name">${escapeHtml(dirName(id))}</span>
                <span class="msg-friend-bio">${escapeHtml(DIR_MAP[id]?.bio || '请求加你为好友')}</span>
            </div>
            <div class="msg-friend-actions">
                <button class="msg-mini-btn primary" data-accept="${id}" type="button">接受</button>
                <button class="msg-mini-btn" data-reject="${id}" type="button">拒绝</button>
            </div>
        </div>`).join('');

    const friendRows = friends.length ? friends.map((id) => `
        <div class="msg-friend-item">
            ${avatarHtml(id, 44)}
            <div class="msg-friend-main">
                <span class="msg-friend-name">${escapeHtml(dirName(id))}</span>
                <span class="msg-friend-bio">${escapeHtml(DIR_MAP[id]?.bio || '')}</span>
            </div>
            <div class="msg-friend-actions">
                <button class="msg-mini-btn primary" data-chat-with="${id}" type="button"><i class="fas fa-comment"></i> 发消息</button>
            </div>
        </div>`).join('') : `<div class="msg-empty-sm">还没有好友，搜索添加吧</div>`;

    view.innerHTML = `
        <div class="msg-add-row">
            <input type="text" id="msgAddInput" placeholder="搜索用户名添加好友…" autocomplete="off">
            <button class="msg-mini-btn primary" id="msgAddBtn" type="button"><i class="fas fa-user-plus"></i> 添加</button>
        </div>
        <div id="msgAddResults" class="msg-add-results"></div>
        ${requests.length ? `<h4 class="msg-section-title">新的好友请求 (${requests.length})</h4>${requestRows}` : ''}
        <h4 class="msg-section-title">我的好友 (${friends.length})</h4>
        ${friendRows}`;
}

function searchDirectory(q) {
    const view = document.getElementById('msgAddResults');
    if (!view) return;
    const friends = getFriends();
    const key = q.trim().toLowerCase();
    if (!key) { view.innerHTML = ''; return; }
    const hits = DIRECTORY.filter((u) =>
        u.name.toLowerCase().includes(key) && !friends.includes(u.id));
    if (!hits.length) {
        view.innerHTML = `<div class="msg-empty-sm">没有找到「${escapeHtml(q)}」，换个关键词试试</div>`;
        return;
    }
    view.innerHTML = hits.map((u) => `
        <div class="msg-friend-item">
            ${avatarHtml(u.id, 40)}
            <div class="msg-friend-main">
                <span class="msg-friend-name">${escapeHtml(u.name)}</span>
                <span class="msg-friend-bio">${escapeHtml(u.bio)}</span>
            </div>
            <button class="msg-mini-btn primary" data-add="${u.id}" type="button">加好友</button>
        </div>`).join('');
}

// ============================================================
// 事件绑定（一次性，使用事件委托）
// ============================================================
let _bound = false;
function bindEvents() {
    if (_bound) return;
    _bound = true;
    const page = document.getElementById('messagesPage');
    if (!page) return;

    // Tab 切换
    page.querySelectorAll('.msg-tab').forEach((t) => {
        t.addEventListener('click', () => {
            currentTab = t.dataset.tab;
            openChatId = null;
            renderTabs();
            currentTab === 'chats' ? renderChats() : renderFriends();
        });
    });

    // 点击委托：会话项 / 返回 / 好友操作 / 添加
    page.addEventListener('click', (e) => {
        const convo = e.target.closest('[data-chat]');
        if (convo) { openChatId = convo.dataset.chat; renderChats(); return; }

        if (e.target.closest('#msgBackBtn')) { openChatId = null; renderChats(); return; }

        const chatWith = e.target.closest('[data-chat-with]');
        if (chatWith) {
            currentTab = 'chats';
            openChatId = chatWith.dataset.chatWith;
            renderTabs();
            renderChats();
            return;
        }

        const accept = e.target.closest('[data-accept]');
        if (accept) {
            const id = accept.dataset.accept;
            writeState(KEY.requests(), getRequests().filter((x) => x !== id));
            const friends = getFriends();
            if (!friends.includes(id)) friends.push(id);
            writeState(KEY.friends(), friends);
            showToast(`已添加好友：${dirName(id)}`);
            renderFriends();
            return;
        }
        const reject = e.target.closest('[data-reject]');
        if (reject) {
            const id = reject.dataset.reject;
            writeState(KEY.requests(), getRequests().filter((x) => x !== id));
            renderFriends();
            return;
        }
        const add = e.target.closest('[data-add]');
        if (add) {
            const id = add.dataset.add;
            const friends = getFriends();
            if (!friends.includes(id)) friends.push(id);
            writeState(KEY.friends(), friends);
            showToast(`已添加好友：${dirName(id)}`);
            const input = document.getElementById('msgAddInput');
            if (input) input.value = '';
            document.getElementById('msgAddResults').innerHTML = '';
            renderFriends();
            return;
        }
        if (e.target.closest('#msgAddBtn')) {
            const input = document.getElementById('msgAddInput');
            searchDirectory(input ? input.value : '');
        }
    });

    // 搜索输入实时过滤 + 发送消息（委托到 page 的 submit/input）
    page.addEventListener('input', (e) => {
        if (e.target.id === 'msgAddInput') searchDirectory(e.target.value);
    });
    page.addEventListener('submit', (e) => {
        if (e.target.id !== 'msgChatForm') return;
        e.preventDefault();
        const input = document.getElementById('msgChatText');
        const text = input ? input.value.trim() : '';
        if (!text || !openChatId) return;
        input.value = '';
        sendMessage(openChatId, text);
    });
}

// ============================================================
// 对外接口（与其他页面模块保持一致：init + refresh）
// ============================================================
export function initMessagesPage() {
    bindEvents();
}

export function refreshMessages() {
    seedOnce();
    bindEvents();
    renderTabs();
    currentTab === 'chats' ? renderChats() : renderFriends();
}
