import { chatRecommendStream, getConversationList, getConversationMessages, deleteConversation, batchDeleteConversations } from '../api.js';
import { showToast, formatDateShort, formatRelativeTime } from '../utils.js';
import { isLoggedIn } from '../auth.js';

let currentSessionId = null;
let _conversationListLoaded = false;
let _batchModeEnabled = false;
const _selectedSessions = new Set();

// 发送锁：上一次请求未完成时忽略新的发送
let isSending = false;

const POI_TYPE_LABELS = {
    '050000': '餐饮',
    '050100': '中餐厅',
    '050200': '外国餐厅',
    '050300': '快餐厅',
    '050500': '冷饮店',
    '050600': '糕饼店',
    '050700': '甜品店',
    '050800': '茶餐厅',
    '050900': '甜品烘焙',
    '051000': '咖啡厅',
    '051100': '茶艺馆',
};

function formatPoiTypeLabel(typeStr) {
    if (!typeStr) return '';
    const text = String(typeStr).trim();
    if (!text || text === '本地补充' || text.startsWith('osm:')) return '';
    if (/^\d{6}$/.test(text)) return POI_TYPE_LABELS[text] || '';
    if (text.includes(';')) {
        const parts = text.split(';').map(s => s.trim()).filter(Boolean);
        const meaningful = parts.filter(p => p !== '餐饮服务');
        return meaningful.length ? meaningful[meaningful.length - 1] : (parts[parts.length - 1] || '');
    }
    if (/^\d{3,6}$/.test(text)) return POI_TYPE_LABELS[text.padStart(6, '0')] || '';
    return text;
}

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

function renderCandidateCards(candidates, messagesDiv) {
    if (!candidates || !candidates.length || !messagesDiv) return;
    const candDiv = document.createElement('div');
    candDiv.className = 'chat-message chat-bot';
    let html = `<div class="ai-candidates">
        <div class="ai-candidates-label"><i class="fas fa-utensils"></i> 推荐餐厅</div>
        <div class="ai-candidate-head" aria-hidden="true">
            <span>店名</span><span>距离</span><span>评分</span><span>人均</span><span>类型</span>
        </div>`;
    candidates.forEach(c => {
        const distStr = c.distance_text || '';
        const typeStr = formatPoiTypeLabel(c.type || '');
        const ratingStr = c.rating && c.rating !== '暂无评分' ? c.rating : '';
        const costStr = c.cost && c.cost !== '暂无价格' ? c.cost : '';
        html += `<div class="ai-candidate-item">
                    <span class="ai-candidate-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
                    <span class="ai-candidate-dist">${distStr ? escapeHtml(distStr) : '—'}</span>
                    <span class="ai-candidate-rating">${ratingStr ? escapeHtml(ratingStr) : '—'}</span>
                    <span class="ai-candidate-cost">${costStr ? escapeHtml(costStr) : '—'}</span>
                    <span class="ai-candidate-type">${typeStr ? escapeHtml(typeStr) : '—'}</span>
                 </div>`;
    });
    html += '</div>';
    candDiv.innerHTML = html;
    messagesDiv.appendChild(candDiv);
}

function setSendLock(locked) {
    const sendBtn = document.getElementById('sendChatBtn');
    const input = document.getElementById('chatInput');
    if (sendBtn) sendBtn.disabled = locked;
    if (input) input.classList.toggle('ai-input-busy', locked);
    document.querySelectorAll('.quick-q-btn').forEach(b => { b.disabled = locked; });
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

function updateBatchUiState() {
    const toggleBtn = document.getElementById('aiBatchToggleBtn');
    const deleteBtn = document.getElementById('aiBatchDeleteBtn');
    const cancelBtn = document.getElementById('aiBatchCancelBtn');
    const listContainer = document.getElementById('aiConversationList');
    const selectedCount = _selectedSessions.size;

    if (toggleBtn) toggleBtn.style.display = _batchModeEnabled ? 'none' : '';
    if (deleteBtn) {
        deleteBtn.style.display = _batchModeEnabled ? '' : 'none';
        deleteBtn.disabled = selectedCount === 0;
        deleteBtn.innerHTML = `<i class="fas fa-trash-can"></i> 删除(${selectedCount})`;
    }
    if (cancelBtn) cancelBtn.style.display = _batchModeEnabled ? '' : 'none';
    listContainer?.classList.toggle('batch-mode', _batchModeEnabled);
}

function setBatchMode(enabled) {
    _batchModeEnabled = enabled;
    if (!enabled) _selectedSessions.clear();
    updateBatchUiState();
}

function toggleSessionSelection(sessionId) {
    if (!sessionId) return;
    if (_selectedSessions.has(sessionId)) _selectedSessions.delete(sessionId);
    else _selectedSessions.add(sessionId);
    updateBatchUiState();
}

async function loadConversationList(force = false) {
    if (!isLoggedIn()) return;
    if (!force && _conversationListLoaded) return;
    const listContainer = document.getElementById('aiConversationList');
    if (!listContainer) return;
    try {
        const data = await getConversationList();
        const sessions = data.items || [];
        if (sessions.length === 0) {
            if (_batchModeEnabled) setBatchMode(false);
            listContainer.innerHTML = '<div class="ai-conv-empty"><i class="fas fa-comment"></i> 暂无历史对话</div>';
            return;
        }
        listContainer.innerHTML = sessions.map(session => `
            <div class="ai-conv-item ${_selectedSessions.has(session.session_id) ? 'selected' : ''}" data-session-id="${escapeHtml(session.session_id)}">
                <input class="ai-conv-check" type="checkbox" data-session-id="${escapeHtml(session.session_id)}" ${_selectedSessions.has(session.session_id) ? 'checked' : ''} aria-label="选择会话">
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
                if (e.target.closest('.ai-conv-delete') || e.target.closest('.ai-conv-check')) return;
                const sid = item.getAttribute('data-session-id');
                if (!sid) return;
                if (_batchModeEnabled) {
                    toggleSessionSelection(sid);
                    item.classList.toggle('selected', _selectedSessions.has(sid));
                    const checkbox = item.querySelector('.ai-conv-check');
                    if (checkbox) checkbox.checked = _selectedSessions.has(sid);
                    return;
                }
                loadConversation(sid);
            });
        });
        listContainer.querySelectorAll('.ai-conv-check').forEach(box => {
            box.addEventListener('click', (e) => {
                e.stopPropagation();
                const sid = box.getAttribute('data-session-id');
                if (!sid) return;
                toggleSessionSelection(sid);
                box.checked = _selectedSessions.has(sid);
                const row = box.closest('.ai-conv-item');
                if (row) row.classList.toggle('selected', _selectedSessions.has(sid));
            });
        });
        listContainer.querySelectorAll('.ai-conv-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (_batchModeEnabled) return;
                const sid = btn.getAttribute('data-session-id');
                if (sid && confirm('确定要删除这个对话吗？')) await deleteConversationHandler(sid);
            });
        });
        if (currentSessionId) highlightCurrentSession(currentSessionId);
        updateBatchUiState();
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

async function batchDeleteConversationHandler() {
    const sessionIds = Array.from(_selectedSessions);
    if (sessionIds.length === 0) {
        showToast('请先勾选要删除的会话');
        return;
    }
    if (!confirm(`确定删除选中的 ${sessionIds.length} 个会话吗？此操作不可恢复。`)) return;

    try {
        const res = await batchDeleteConversations(sessionIds);
        const deletedSessions = res.deleted_sessions ?? sessionIds.length;
        if (currentSessionId && _selectedSessions.has(currentSessionId)) startNewChat();
        showToast(`已删除 ${deletedSessions} 个会话`);
        setBatchMode(false);
        await loadConversationList(true);
    } catch (err) {
        if (err.message === 'UNAUTHORIZED') {
            showToast('登录已过期，请重新登录');
            document.getElementById('authModal').style.display = 'flex';
            return;
        }
        showToast('批量删除失败: ' + err.message);
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
    const batchToggleBtn = document.getElementById('aiBatchToggleBtn');
    const batchDeleteBtn = document.getElementById('aiBatchDeleteBtn');
    const batchCancelBtn = document.getElementById('aiBatchCancelBtn');

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
            if (_batchModeEnabled) setBatchMode(false);
            startNewChat();
            if (window.innerWidth <= 768) closeMobileSidebar();
        });
    }
    if (batchToggleBtn) {
        batchToggleBtn.addEventListener('click', async () => {
            setBatchMode(true);
            await loadConversationList(true);
        });
    }
    if (batchCancelBtn) {
        batchCancelBtn.addEventListener('click', async () => {
            setBatchMode(false);
            await loadConversationList(true);
        });
    }
    if (batchDeleteBtn) {
        batchDeleteBtn.addEventListener('click', batchDeleteConversationHandler);
    }
    updateBatchUiState();

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
    const messagesDiv = document.getElementById('chatMessages');
    if (!input || !messagesDiv) return;
    if (isSending) return;

    const msg = input.value.trim();
    if (!msg) return;
    if (!isLoggedIn()) {
        showToast('请先登录使用AI助手');
        document.getElementById('authModal').style.display = 'flex';
        return;
    }

    // 加锁：禁止发送，但输入框仍可打字
    isSending = true;
    setSendLock(true);

    input.value = '';
    hideWelcome();

    const userMsg = document.createElement('div');
    userMsg.className = 'chat-message chat-user';
    userMsg.textContent = msg;
    messagesDiv.appendChild(userMsg);
    scrollToBottom();
    showThinking();

    // 获取用户定位：用于展示“你离店有多远”；检索排序由后端按消息里的校区锚点处理。
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
        // 定位失败时，距离退化为按检索锚点计算
    }

    const botMsg = document.createElement('div');
    botMsg.className = 'chat-message chat-bot';
    let streamStarted = false;
    let streamCandidates = [];

    const ensureBotBubble = () => {
        if (!streamStarted) {
            removeThinking();
            botMsg.textContent = '';
            messagesDiv.appendChild(botMsg);
            streamStarted = true;
        }
    };

    try {
        await chatRecommendStream(msg, currentSessionId, '南京', userLocation, {
            onMeta: async (payload) => {
                if (payload.session_id) {
                    const newSession = currentSessionId !== payload.session_id;
                    currentSessionId = payload.session_id;
                    if (newSession) {
                        _conversationListLoaded = false;
                        await loadConversationList(true);
                    } else {
                        await refreshSidebar();
                    }
                    highlightCurrentSession(currentSessionId);
                }
                streamCandidates = payload.candidates || [];
            },
            onToken: (text) => {
                ensureBotBubble();
                botMsg.textContent += text;
                scrollToBottom();
            },
            onDone: (payload) => {
                ensureBotBubble();
                const finalReply = stripMarkdown(payload.reply || botMsg.textContent || '');
                botMsg.textContent = finalReply;
                renderCandidateCards(streamCandidates, messagesDiv);
                scrollToBottom();
            },
            onError: (message) => {
                throw new Error(message || 'AI 回复失败');
            },
        });

        if (!streamStarted) {
            removeThinking();
        }
        renderQuickQuestions();
        await refreshSidebar();
    } catch (e) {
        removeThinking();
        if (streamStarted && botMsg.parentNode) {
            botMsg.remove();
        }
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
        isSending = false;
        setSendLock(false);
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
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!isSending) sendMessage();
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
