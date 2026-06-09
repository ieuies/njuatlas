import { chatRecommend, getConversationList, getConversationMessages, deleteConversation } from '../api.js';
import { showToast, formatDateShort, formatRelativeTime } from '../utils.js';
import { isLoggedIn } from '../auth.js';

let currentSessionId = null;
let _conversationListLoaded = false;

// 发送锁：上一次请求未完成时忽略新的发送
let isSending = false;

function stripMarkdown(text) {
    return text
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/`{1,3}[^`]*`{1,3}/g, '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^[-*+]\s+/gm, '')
        .replace(/^\d+\.\s+/gm, '')
        .replace(/\[(.+?)\]\(.+?\)/g, '$1')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/^>\s+/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

const questionTemplates = [
    { base: '推荐一家{type}餐厅', slot: ['川菜','湘菜','粤菜','江浙菜','东北菜','日料','韩餐','火锅','烧烤','麻辣烫'] },
    { base: '南大附近有什么好吃的{type}', slot: ['早餐店','面馆','饺子馆','奶茶店','咖啡厅','甜品店','小吃摊','夜宵摊','快餐','自助餐'] },
    { base: '我想去{type}，有推荐吗', slot: ['聚餐','约会','一个人吃饭','请客','吃夜宵','吃早餐'] },
    { base: '有没有{type}的餐厅', slot: ['安静','性价比高','上菜快','适合自习','有包厢','环境好','便宜又好吃','评分高'] },
    { base: '南大{type}附近有什么吃的', slot: ['仙林校区','鼓楼校区','南门','北门','汉口路','珠江路'] },
    { base: '南大周边有什么值得去的{type}', slot: ['咖啡馆','奶茶店','火锅店','日料店','烧烤摊','小吃街','面包房'] },
    { base: '{type}去哪吃比较好', slot: ['和室友聚餐','和对象约会','一个人吃午饭','周末改善伙食','生日请客','考试后放松'] },
];

function generateRandomQuestions(count) {
    count = count || 5;
    const shuffled = shuffle([...questionTemplates]);
    const questions = [];
    for (let i = 0; i < Math.min(count, shuffled.length); i++) {
        const tpl = shuffled[i];
        const slotVal = tpl.slot[Math.floor(Math.random() * tpl.slot.length)];
        questions.push(tpl.base.replace('{type}', slotVal));
    }
    return questions;
}

function renderQuickQuestions() {
    const container = document.getElementById('quickQuestions');
    if (!container) return;
    container.innerHTML = '';
    const questions = generateRandomQuestions(5);
    questions.forEach(q => {
        const btn = document.createElement('button');
        btn.className = 'quick-q-btn';
        btn.textContent = q;
        btn.addEventListener('click', () => {
            const input = document.getElementById('chatInput');
            if (input) input.value = q;
            sendMessage();
        });
        container.appendChild(btn);
    });
}

function hideWelcome() {
    const welcome = document.getElementById('aiWelcome');
    if (welcome) welcome.style.display = 'none';
}

function showWelcome() {
    const welcome = document.getElementById('aiWelcome');
    if (welcome) welcome.style.display = 'flex';
}

function clearChatMessages() {
    const messagesDiv = document.getElementById('chatMessages');
    if (!messagesDiv) return;
    const welcome = messagesDiv.querySelector('.ai-welcome');
    messagesDiv.innerHTML = '';
    if (welcome) messagesDiv.appendChild(welcome);
    hideWelcome();
}

function renderMessages(messages) {
    const messagesDiv = document.getElementById('chatMessages');
    if (!messagesDiv) return;
    const welcome = messagesDiv.querySelector('.ai-welcome');
    messagesDiv.innerHTML = '';
    if (welcome) messagesDiv.appendChild(welcome);
    hideWelcome();
    if (!messages || messages.length === 0) {
        showWelcome();
        return;
    }
    messages.forEach(msg => {
        const div = document.createElement('div');
        div.className = `chat-message ${msg.role === 'user' ? 'chat-user' : 'chat-bot'}`;
        div.textContent = msg.role === 'assistant' ? stripMarkdown(msg.content) : msg.content;
        messagesDiv.appendChild(div);
    });
    scrollToBottom();
}

function showThinking() {
    const messagesDiv = document.getElementById('chatMessages');
    if (!messagesDiv) return null;
    hideWelcome();
    const div = document.createElement('div');
    div.className = 'chat-message chat-thinking';
    div.id = 'aiThinkingMsg';
    div.innerHTML = '<div class="thinking-container"><span class="thinking-icon icon-spinner" aria-hidden="true"></span><span class="thinking-text">小南正在思考</span><span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span></div>';
    messagesDiv.appendChild(div);
    scrollToBottom();
    return div;
}

function removeThinking() {
    const el = document.getElementById('aiThinkingMsg');
    if (el) el.remove();
}

function scrollToBottom() {
    const div = document.getElementById('chatMessages');
    if (div) requestAnimationFrame(() => div.scrollTop = div.scrollHeight);
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ==================== 侧栏相关 ====================

async function loadConversationList(force = false) {
    if (!isLoggedIn()) return;
    if (!force && _conversationListLoaded) return;
    const listContainer = document.getElementById('aiConversationList');
    if (!listContainer) return;
    try {
        const data = await getConversationList();
        const sessions = data.items || [];
        if (sessions.length === 0) {
            listContainer.innerHTML = '<div class="ai-conv-empty"><i class="fas fa-comment"></i> 暂无历史对话</div>';
            return;
        }
        listContainer.innerHTML = sessions.map(session => `
            <div class="ai-conv-item" data-session-id="${escapeHtml(session.session_id)}">
                <div class="ai-conv-content">
                    <div class="ai-conv-title">${escapeHtml(session.last_message?.substring(0, 30) || '新对话')}</div>
                    <div class="ai-conv-preview">${escapeHtml(formatDateShort(session.last_at))}</div>
                </div>
                <div class="ai-conv-time">${formatRelativeTime(session.last_at)}</div>
                <button class="ai-conv-delete" data-session-id="${escapeHtml(session.session_id)}" title="删除会话"><i class="fas fa-trash-can"></i></button>
            </div>
        `).join('');

        listContainer.querySelectorAll('.ai-conv-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.ai-conv-delete')) return;
                const sid = item.getAttribute('data-session-id');
                if (sid) loadConversation(sid);
            });
        });
        listContainer.querySelectorAll('.ai-conv-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const sid = btn.getAttribute('data-session-id');
                if (sid && confirm('确定要删除这个对话吗？')) await deleteConversationHandler(sid);
            });
        });
        if (currentSessionId) highlightCurrentSession(currentSessionId);
        _conversationListLoaded = true;
    } catch (err) {
        // token 过期时 api.js 已清理 localStorage，isLoggedIn() 会返回 false
        // 这里静默处理，sendMessage 会弹出登录框引导用户
        if (err.message === 'UNAUTHORIZED') {
            listContainer.innerHTML = '<div class="ai-conv-empty"><i class="fas fa-lock"></i> 请登录后查看历史对话</div>';
            return;
        }
        console.warn('加载会话列表失败:', err);
        listContainer.innerHTML = '<div class="ai-conv-empty">加载失败，请刷新重试</div>';
    }
}

function highlightCurrentSession(sessionId) {
    document.querySelectorAll('.ai-conv-item').forEach(item => {
        const sid = item.getAttribute('data-session-id');
        item.classList.toggle('active', sid === sessionId);
    });
}

async function loadConversation(sessionId) {
    if (!sessionId) return;
    try {
        const data = await getConversationMessages(sessionId);
        const messages = data.messages || [];
        currentSessionId = sessionId;
        clearChatMessages();
        if (messages.length === 0) showWelcome();
        else renderMessages(messages);
        highlightCurrentSession(sessionId);
        if (window.innerWidth <= 768) closeMobileSidebar();
    } catch (err) {
        if (err.message === 'UNAUTHORIZED') {
            showToast('登录已过期，请重新登录');
            document.getElementById('authModal').style.display = 'flex';
            return;
        }
        showToast('加载对话失败: ' + err.message);
    }
}

async function deleteConversationHandler(sessionId) {
    try {
        await deleteConversation(sessionId);
        showToast('对话已删除');
        if (currentSessionId === sessionId) startNewChat();
        await loadConversationList(true);
    } catch (err) {
        if (err.message === 'UNAUTHORIZED') {
            showToast('登录已过期，请重新登录');
            document.getElementById('authModal').style.display = 'flex';
            return;
        }
        showToast('删除失败: ' + err.message);
    }
}

function startNewChat() {
    currentSessionId = null;
    clearChatMessages();
    showWelcome();
    highlightCurrentSession(null);
}

async function refreshSidebar() {
    await loadConversationList(true);
}

// 侧栏 UI 控制
function initSidebarControls() {
    const sidebar = document.getElementById('aiSidebar');
    if (sidebar?.dataset.controlsReady === 'true') return;
    if (sidebar) sidebar.dataset.controlsReady = 'true';

    const toggleBtn = document.getElementById('aiSidebarToggle');
    const expandBtn = document.getElementById('aiSidebarExpand');
    const newChatBtn = document.getElementById('aiNewChatBtn');

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => sidebar?.classList.toggle('collapsed'));
    }

    if (expandBtn) {
        expandBtn.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                sidebar?.classList.add('open');
            } else {
                sidebar?.classList.remove('collapsed');
            }
        });
    }

    if (newChatBtn) {
        newChatBtn.addEventListener('click', () => {
            startNewChat();
            if (window.innerWidth <= 768) closeMobileSidebar();
        });
    }

    // 点击侧边栏外部区域关闭（移动端）
    document.addEventListener('click', (e) => {
        if (window.innerWidth > 768) return;
        const isSidebar = sidebar?.contains(e.target);
        const isExpandBtn = expandBtn?.contains(e.target);
        if (sidebar?.classList.contains('open') && !isSidebar && !isExpandBtn) {
            closeMobileSidebar();
        }
    });
}
function closeMobileSidebar() {
    document.getElementById('aiSidebar')?.classList.remove('open');
}

// ==================== 发送消息 ====================

async function sendMessage() {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendChatBtn');
    const messagesDiv = document.getElementById('chatMessages');
    if (!input || !messagesDiv || !sendBtn) return;

    const msg = input.value.trim();
    if (!msg) return;
    if (!isLoggedIn()) {
        showToast('请先登录使用AI助手');
        document.getElementById('authModal').style.display = 'flex';
        return;
    }

    // 加锁：禁用所有发送入口（按钮 + 快捷键 + 快捷问题）
    isSending = true;
    sendBtn.disabled = true;
    input.disabled = true;
    document.querySelectorAll('.quick-q-btn').forEach(b => b.disabled = true);

    input.value = '';
    hideWelcome();

    const userMsg = document.createElement('div');
    userMsg.className = 'chat-message chat-user';
    userMsg.textContent = msg;
    messagesDiv.appendChild(userMsg);
    scrollToBottom();
    showThinking();

    // 获取用户定位，失败不阻塞
    let userLocation = null;
    try {
        const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                timeout: 5000,
                maximumAge: 300000
            });
        });
        userLocation = `${pos.coords.longitude},${pos.coords.latitude}`;
    } catch {
        // 定位失败退化为全市搜索
    }

    try {
        const res = await chatRecommend(msg, currentSessionId, '南京', userLocation);
        if (res.session_id) {
            const newSession = currentSessionId !== res.session_id;
            currentSessionId = res.session_id;
            if (newSession) {
                _conversationListLoaded = false;
                await loadConversationList(true);
            } else await refreshSidebar();
            highlightCurrentSession(currentSessionId);
        }
        removeThinking();

        const rawReply = res.reply || '抱歉，AI 暂时无法回答';
        const cleanReply = stripMarkdown(rawReply);

        const botMsg = document.createElement('div');
        botMsg.className = 'chat-message chat-bot';
        botMsg.textContent = cleanReply;
        messagesDiv.appendChild(botMsg);

        if (res.candidates && res.candidates.length) {
            const candDiv = document.createElement('div');
            candDiv.className = 'chat-message chat-bot';
            let html = '<div class="ai-candidates"><div class="ai-candidates-label"><i class="fas fa-utensils"></i> 推荐餐厅</div>';
            res.candidates.forEach(c => {
                const distStr = c.distance_text || '';
                const typeStr = c.type || '';
                html += `<div class="ai-candidate-item">
                            <span class="ai-candidate-name">${escapeHtml(c.name)}</span>
                            <span class="ai-candidate-meta">
                                <span>${distStr ? `<i class="fas fa-location-dot" aria-hidden="true"></i> ${escapeHtml(distStr)}` : ''}</span>
                                <span><i class="fas fa-star" aria-hidden="true"></i> ${escapeHtml(c.rating)}</span>
                                <span><i class="fas fa-coins" aria-hidden="true"></i> ${escapeHtml(c.cost)}</span>
                                ${typeStr ? `<span><i class="fas fa-tag" aria-hidden="true"></i> ${escapeHtml(typeStr)}</span>` : ''}
                            </span>
                         </div>`;
            });
            html += '</div>';
            candDiv.innerHTML = html;
            messagesDiv.appendChild(candDiv);
        }

        scrollToBottom();
        renderQuickQuestions();
        await refreshSidebar();
    } catch (e) {
        removeThinking();
        // token 过期：弹出登录框，引导用户重新登录
        if (e.message === 'UNAUTHORIZED') {
            showToast('登录已过期，请重新登录');
            document.getElementById('authModal').style.display = 'flex';
            return;
        }
        const errDiv = document.createElement('div');
        errDiv.className = 'chat-message chat-bot';
        errDiv.textContent = '抱歉，AI 回复失败，请稍后重试';
        messagesDiv.appendChild(errDiv);
        scrollToBottom();
    } finally {
        // 释放锁
        isSending = false;
        sendBtn.disabled = false;
        input.disabled = false;
        document.querySelectorAll('.quick-q-btn').forEach(b => b.disabled = false);
        input.focus();
    }
}

// 移动端软键盘适配：使用 visualViewport API 避免键盘遮挡输入框
function initViewportAdaptation() {
    const container = document.getElementById('aiPage');
    if (!container || !window.visualViewport || container.dataset.viewportReady === 'true') return;
    container.dataset.viewportReady = 'true';

    const applyViewport = () => {
        const viewport = window.visualViewport;
        // 仅在移动端（宽度 ≤ 768）且键盘弹出时（视口高度明显变小）调整
        if (window.innerWidth <= 768 && viewport.height < window.innerHeight - 60) {
            const offset = window.innerHeight - viewport.height;
            container.style.paddingBottom = offset + 'px';
        } else {
            container.style.paddingBottom = '';
        }
        // 确保输入框在可视区域内
        const input = document.getElementById('chatInput');
        if (input && document.activeElement === input) {
            requestAnimationFrame(() => {
                input.scrollIntoView({ block: 'end', behavior: 'instant' });
            });
        }
    };

    window.visualViewport.addEventListener('resize', applyViewport);
    window.visualViewport.addEventListener('scroll', applyViewport);
}

// 初始化
export function initAIPage() {
    const sendBtn = document.getElementById('sendChatBtn');
    const input = document.getElementById('chatInput');
    if (!sendBtn || !input) return;

    sendBtn.onclick = sendMessage;
    if (input.dataset.aiReady !== 'true') {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        // 输入框聚焦时滚动到底部
        input.addEventListener('focus', () => {
            setTimeout(() => scrollToBottom(), 300);
        });
        input.dataset.aiReady = 'true';
    }

    initSidebarControls();
    initViewportAdaptation();
    if (isLoggedIn()) loadConversationList();
    renderQuickQuestions();
}

window.initAIPage = initAIPage;
