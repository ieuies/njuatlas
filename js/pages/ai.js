import { chatRecommend, getConversationList, getConversationMessages, deleteConversation } from '../api.js';
import { showToast } from '../utils.js';
import { isLoggedIn } from '../auth.js';

let currentSessionId = null;

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
    div.innerHTML = '<span class="chat-thinking-dot"></span><span class="chat-thinking-dot"></span><span class="chat-thinking-dot"></span>';
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

async function loadConversationList() {
    if (!isLoggedIn()) return;
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
                    <div class="ai-conv-preview">${escapeHtml(formatSessionTime(session.last_at))}</div>
                </div>
                <div class="ai-conv-time">${formatRelativeTime(session.last_at)}</div>
                <button class="ai-conv-delete" data-session-id="${escapeHtml(session.session_id)}" title="删除会话"><i class="fas fa-trash-alt"></i></button>
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
    } catch (err) {
        console.warn('加载会话列表失败:', err);
        listContainer.innerHTML = '<div class="ai-conv-empty">加载失败，请刷新重试</div>';
    }
}

function formatSessionTime(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatRelativeTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
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
        showToast('加载对话失败: ' + err.message);
    }
}

async function deleteConversationHandler(sessionId) {
    try {
        await deleteConversation(sessionId);
        showToast('对话已删除');
        if (currentSessionId === sessionId) startNewChat();
        await loadConversationList();
    } catch (err) {
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
    await loadConversationList();
}

// 侧栏 UI 控制
function initSidebarControls() {
    const sidebar = document.getElementById('aiSidebar');
    const toggleBtn = document.getElementById('aiSidebarToggle');
    const expandBtn = document.getElementById('aiSidebarExpand');
    const newChatBtn = document.getElementById('aiNewChatBtn');

    // 桌面端：折叠/展开按钮（侧栏内部的 X 按钮）
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => sidebar?.classList.toggle('collapsed'));
    }

    // 桌面端：展开按钮（聊天区域左上角菜单按钮）
    if (expandBtn) {
        expandBtn.addEventListener('click', () => {
            sidebar?.classList.remove('collapsed');
            if (window.innerWidth <= 768) {
                sidebar?.classList.remove('open');
            }
        });
    }

    // 移动端：点击背景关闭侧栏
    if (sidebar) {
        sidebar.addEventListener('click', (e) => {
            if (e.target === sidebar) closeMobileSidebar();
        });
    }

    // 新建对话按钮
    if (newChatBtn) {
        newChatBtn.addEventListener('click', () => {
            startNewChat();
            if (window.innerWidth <= 768) closeMobileSidebar();
        });
    }

    // 窗口大小变化时重置状态
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            closeMobileSidebar();
            sidebar?.classList.remove('open');
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
        return;
    }

    sendBtn.disabled = true;
    input.value = '';
    hideWelcome();

    const userMsg = document.createElement('div');
    userMsg.className = 'chat-message chat-user';
    userMsg.textContent = msg;
    messagesDiv.appendChild(userMsg);
    scrollToBottom();
    showThinking();

    try {
        const res = await chatRecommend(msg, currentSessionId);
        if (res.session_id) {
            const newSession = currentSessionId !== res.session_id;
            currentSessionId = res.session_id;
            if (newSession) await loadConversationList();
            else await refreshSidebar();
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
                html += `<div class="ai-candidate-item">
                            <span class="ai-candidate-name">${escapeHtml(c.name)}</span>
                            <span class="ai-candidate-meta">
                                <span>⭐ ${escapeHtml(c.rating)}</span>
                                <span>💰 ${escapeHtml(c.cost)}</span>
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
        const errDiv = document.createElement('div');
        errDiv.className = 'chat-message chat-bot';
        errDiv.textContent = '抱歉，AI 回复失败，请稍后重试';
        messagesDiv.appendChild(errDiv);
        scrollToBottom();
    } finally {
        sendBtn.disabled = false;
        input.focus();
    }
}

// 粒子效果
export function initParticles(containerId = 'aiParticles') {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    const colors = ['#7c3aed','#8b5cf6','#a78bfa','#c084fc','#e9d5ff','#f472b6','#818cf8','#c4b5fd'];
    const count = window.innerWidth < 600 ? 20 : 32;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'ai-particle';
        p.style.top = `-${5 + Math.random() * 20}vh`;
        p.style.left = `${Math.random() * 100}%`;
        p.style.width = `${3 + Math.random() * 6}px`;
        p.style.height = `${3 + Math.random() * 6}px`;
        p.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
        p.style.background = colors[Math.floor(Math.random() * colors.length)];
        p.style.animationDuration = `${8 + Math.random() * 14}s`;
        p.style.animationDelay = `${Math.random() * 10}s`;
        p.style.opacity = 0.15 + Math.random() * 0.35;
        frag.appendChild(p);
    }
    container.appendChild(frag);
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
        input.dataset.aiReady = 'true';
    }

    initSidebarControls();
    if (isLoggedIn()) loadConversationList();
    renderQuickQuestions();
    initParticles('aiParticles');

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => initParticles('aiParticles'), 400);
    });
}

window.initAIPage = initAIPage;
