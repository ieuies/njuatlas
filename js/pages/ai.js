import { chatRecommendStream, getConversationList, getConversationMessages, deleteConversation, batchDeleteConversations } from '../api.js';
import { showToast, formatDateShort, formatRelativeTime, avatarHtmlForUser } from '../utils.js';
import { isLoggedIn, getUser } from '../auth.js';

const AI_HEAD_AVATAR = 'image/aihelper-head.png?v=4';
const CHAT_AVATAR_SIZE = 36;

function createChatRow(role) {
    const row = document.createElement('div');
    row.className = `ai-chat-row ai-chat-row--${role === 'user' ? 'user' : 'bot'}`;

    const avatar = document.createElement('div');
    avatar.className = 'ai-chat-row__avatar';
    if (role === 'user') {
        avatar.innerHTML = avatarHtmlForUser(getUser(), CHAT_AVATAR_SIZE);
    } else {
        avatar.innerHTML = `<img class="ai-bot-avatar" src="${AI_HEAD_AVATAR}" alt="小鲸灵" width="${CHAT_AVATAR_SIZE}" height="${CHAT_AVATAR_SIZE}" loading="lazy" decoding="async">`;
    }

    const body = document.createElement('div');
    body.className = 'ai-chat-row__body';

    if (role === 'user') {
        row.appendChild(body);
        row.appendChild(avatar);
    } else {
        row.appendChild(avatar);
        row.appendChild(body);
    }
    return { row, body };
}

function appendChatBubble(messagesDiv, role, text) {
    const { row, body } = createChatRow(role);
    const bubble = document.createElement('div');
    bubble.className = `chat-message chat-${role === 'user' ? 'user' : 'bot'}`;
    if (text != null && text !== '') bubble.textContent = text;
    body.appendChild(bubble);
    messagesDiv.appendChild(row);
    return { row, body, bubble };
}

function appendToChatRowBody(anchorEl, messagesDiv, el) {
    const body = anchorEl?.closest('.ai-chat-row__body');
    if (body) {
        body.appendChild(el);
        if (el.classList.contains('ai-candidate-cards')) {
            body.closest('.ai-chat-row')?.classList.add('ai-chat-row--wide');
        }
        return;
    }
    if (anchorEl && anchorEl.parentNode === messagesDiv) {
        anchorEl.insertAdjacentElement('afterend', el);
    } else {
        messagesDiv.appendChild(el);
    }
}

let openGuideWithContext = null;

async function _loadGuideNavigator() {
    if (openGuideWithContext) return openGuideWithContext;
    try {
        const mod = await import('./guide.js');
        openGuideWithContext = mod.openGuideWithContext;
        return openGuideWithContext;
    } catch {
        return null;
    }
}

let currentSessionId = null;
let _conversationListLoaded = false;
let _batchModeEnabled = false;
const _selectedSessions = new Set();

// 发送锁：上一次请求未完成时忽略新的发送
let isSending = false;

/** 按会话缓存每轮 assistant 回复对应的推荐卡片（内存 + sessionStorage） */
const sessionTurnCandidates = new Map();

function _candidatesCacheKey(sessionId) {
    return `ai_turn_candidates_${sessionId}`;
}

function loadCandidatesCache(sessionId) {
    if (!sessionId || sessionTurnCandidates.has(sessionId)) return;
    try {
        const raw = sessionStorage.getItem(_candidatesCacheKey(sessionId));
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) sessionTurnCandidates.set(sessionId, parsed);
    } catch {
        // ignore corrupt cache
    }
}

function persistCandidatesCache(sessionId) {
    if (!sessionId) return;
    const list = sessionTurnCandidates.get(sessionId);
    if (!list) return;
    try {
        sessionStorage.setItem(_candidatesCacheKey(sessionId), JSON.stringify(list));
    } catch {
        // quota exceeded etc.
    }
}

function recordTurnCandidates(sessionId, candidates) {
    if (!sessionId || !candidates?.length) return;
    const list = sessionTurnCandidates.get(sessionId) || [];
    list.push(candidates);
    // 只保留最近 30 轮，避免内存/sessionStorage 膨胀
    if (list.length > 30) list.splice(0, list.length - 30);
    sessionTurnCandidates.set(sessionId, list);
    persistCandidatesCache(sessionId);
}

function clearCandidatesCache(sessionId) {
    if (!sessionId) return;
    sessionTurnCandidates.delete(sessionId);
    try {
        sessionStorage.removeItem(_candidatesCacheKey(sessionId));
    } catch {
        // ignore
    }
}

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

const CATEGORY_CARD_META = {
    '美食': { label: '推荐餐厅', icon: 'fa-utensils', showCost: true },
    '咖啡饮品': { label: '推荐饮品店', icon: 'fa-mug-hot', showCost: true },
    '休闲娱乐': { label: '推荐去处', icon: 'fa-film', showCost: false },
    '运动健身': { label: '推荐场馆', icon: 'fa-dumbbell', showCost: false },
    '购物商圈': { label: '推荐商圈', icon: 'fa-bag-shopping', showCost: false },
    '景点公园': { label: '推荐景点', icon: 'fa-tree', showCost: false },
};

const questionTemplates = [
    { base: '推荐一家{type}餐厅', slot: ['川菜','湘菜','粤菜','江浙菜','东北菜','日料','韩餐','火锅','烧烤','麻辣烫'] },
    { base: '南大附近有什么好吃的{type}', slot: ['早餐店','面馆','饺子馆','奶茶店','咖啡厅','甜品店','小吃摊','夜宵摊','快餐','自助餐'] },
    { base: '我想去{type}，有推荐吗', slot: ['聚餐','约会','一个人吃饭','请客','吃夜宵','吃早餐'] },
    { base: '有没有{type}的餐厅', slot: ['安静','性价比高','上菜快','适合自习','有包厢','环境好','便宜又好吃','评分高'] },
    { base: '南大{type}附近有什么吃的', slot: ['仙林校区','鼓楼校区','南门','北门','汉口路','珠江路'] },
    { base: '仙林有什么{type}', slot: ['景点','公园','博物馆','打卡地'] },
    { base: '鼓楼附近有什么{type}', slot: ['电影院','KTV','健身房','商场'] },
    { base: '有没有{type}的组局', slot: ['饭搭子','运动搭子','学习搭子','游戏搭子','电影搭子'] },
    { base: '{type}去哪比较好', slot: ['和室友聚餐','和对象约会','一个人吃午饭','周末改善伙食','生日请客','考试后放松'] },
    { base: '德基有什么{type}', slot: ['吃的','好玩的','逛的'] },
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

function renderCandidateCards(candidates, messagesDiv, anchorEl = null, options = {}) {
    if (!candidates || !candidates.length || !messagesDiv) return null;
    const category = candidates[0]?.guide_category || '美食';
    const meta = CATEGORY_CARD_META[category] || CATEGORY_CARD_META['美食'];
    const campus = candidates[0]?.campus || '鼓楼';
    const showCost = meta.showCost;
    const costHeader = showCost ? '<span>人均</span>' : '';
    const isMallAnchor = options.mode === 'mall_anchor' && options.mall_name;
    const headerLabel = isMallAnchor
        ? `${escapeHtml(options.mall_name)} · 周边店铺`
        : escapeHtml(meta.label);
    const disclaimerHtml = isMallAnchor
        ? '<p class="ai-candidates-disclaimer">以下店铺以商场为中心周边检索，无法保证均在商场室内或具体楼层。</p>'
        : '';

    const candDiv = document.createElement('div');
    candDiv.className = 'ai-candidate-cards';
    let html = `<div class="ai-candidates" data-guide-category="${escapeHtml(category)}" data-guide-campus="${escapeHtml(campus)}">
        <div class="ai-candidates-header">
            <div class="ai-candidates-label"><i class="fas ${meta.icon}"></i> ${headerLabel}</div>
            <button type="button" class="ai-candidates-guide-link" data-campus="${escapeHtml(campus)}" data-category="${escapeHtml(category)}">在吃喝玩乐查看</button>
        </div>
        ${disclaimerHtml}
        <div class="ai-candidate-head${showCost ? '' : ' ai-candidate-head--no-cost'}" aria-hidden="true">
            <span>名称</span><span>距离</span><span>评分</span>${costHeader}<span>类型</span>
        </div>`;
    candidates.forEach(c => {
        const distStr = c.distance_text || '';
        const typeStr = formatPoiTypeLabel(c.type || c.guide_category || '');
        const ratingStr = c.rating && c.rating !== '暂无评分' ? c.rating : '';
        const costStr = showCost && c.cost && c.cost !== '暂无价格' ? c.cost : '';
        const costCell = showCost
            ? `<span class="ai-candidate-cost">${costStr ? escapeHtml(costStr) : '—'}</span>`
            : '';
        html += `<div class="ai-candidate-item${showCost ? '' : ' ai-candidate-item--no-cost'}">
                    <span class="ai-candidate-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
                    <span class="ai-candidate-dist">${distStr ? escapeHtml(distStr) : '—'}</span>
                    <span class="ai-candidate-rating">${ratingStr ? escapeHtml(ratingStr) : '—'}</span>
                    ${costCell}
                    <span class="ai-candidate-type">${typeStr ? escapeHtml(typeStr) : '—'}</span>
                 </div>`;
    });
    html += '</div>';
    candDiv.innerHTML = html;

    candDiv.querySelector('.ai-candidates-guide-link')?.addEventListener('click', async () => {
        const nav = await _loadGuideNavigator();
        if (nav) {
            await nav(campus, category);
        } else if (typeof window.switchPage === 'function') {
            window.switchPage('guide');
        }
    });

    appendToChatRowBody(anchorEl, messagesDiv, candDiv);
    return candDiv;
}

function renderClarificationChips(chips, messagesDiv, anchorEl = null) {
    if (!chips?.length || !messagesDiv) return null;
    const wrap = document.createElement('div');
    wrap.className = 'ai-clarification-chips';
    wrap.innerHTML = `<div class="ai-chip-row">${chips.map((chip) =>
        `<button type="button" class="ai-clarify-chip">${escapeHtml(chip)}</button>`
    ).join('')}</div>`;
    wrap.querySelectorAll('.ai-clarify-chip').forEach((btn) => {
        btn.addEventListener('click', () => {
            const input = document.getElementById('chatInput');
            if (input) input.value = btn.textContent.trim();
            sendMessage();
        });
    });
    appendToChatRowBody(anchorEl, messagesDiv, wrap);
    return wrap;
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

function renderMessages(messages, sessionId = currentSessionId) {
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
    loadCandidatesCache(sessionId);
    const cachedTurns = sessionTurnCandidates.get(sessionId) || [];
    let assistantTurn = 0;
    messages.forEach(msg => {
        const role = msg.role === 'user' ? 'user' : 'bot';
        const text = msg.role === 'assistant' ? stripMarkdown(msg.content) : msg.content;
        const { bubble } = appendChatBubble(messagesDiv, role, text);
        if (msg.role === 'assistant') {
            const turnCandidates = cachedTurns[assistantTurn];
            if (turnCandidates?.length) {
                renderCandidateCards(turnCandidates, messagesDiv, bubble);
            }
            assistantTurn += 1;
        }
    });
    scrollToBottom();
}

function showThinking() {
    const messagesDiv = document.getElementById('chatMessages');
    if (!messagesDiv) return null;
    hideWelcome();
    removeThinking();
    const { row, body } = createChatRow('bot');
    const div = document.createElement('div');
    div.className = 'chat-message chat-thinking';
    div.id = 'aiThinkingMsg';
    div.innerHTML = '<div class="thinking-container"><span class="thinking-icon icon-spinner" aria-hidden="true"></span><span class="thinking-text">小鲸灵正在思考</span><span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span></div>';
    body.appendChild(div);
    messagesDiv.appendChild(row);
    scrollToBottom();
    return div;
}

function removeThinking() {
    const el = document.getElementById('aiThinkingMsg');
    if (!el) return;
    const row = el.closest('.ai-chat-row');
    if (row) row.remove();
    else el.remove();
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

async function loadConversationList(force = false, { silent = false } = {}) {
    if (!isLoggedIn()) return;
    if (!force && _conversationListLoaded) return;
    const listContainer = document.getElementById('aiConversationList');
    if (!listContainer) return;
    try {
        const data = await getConversationList({ silent });
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
        else renderMessages(messages, sessionId);
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
        clearCandidatesCache(sessionId);
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
        sessionIds.forEach((sid) => clearCandidatesCache(sid));
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
        showToast('请先登录使用小鲸灵');
        document.getElementById('authModal').style.display = 'flex';
        return;
    }

    // 加锁：禁止发送，但输入框仍可打字
    isSending = true;
    setSendLock(true);

    input.value = '';
    hideWelcome();

    appendChatBubble(messagesDiv, 'user', msg);
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

    let botRow = null;
    let botMsg = null;
    let streamStarted = false;
    let streamCandidates = [];
    let streamClarificationChips = [];
    let streamMode = null;
    let streamMallName = null;
    let candidateCardsEl = null;
    let clarificationChipsEl = null;
    let sidebarRefreshNeeded = false;
    let sidebarListRefreshNeeded = false;

    const ensureBotBubble = () => {
        if (streamStarted) return;
        removeThinking();
        const created = createChatRow('bot');
        botRow = created.row;
        botMsg = document.createElement('div');
        botMsg.className = 'chat-message chat-bot';
        created.body.appendChild(botMsg);
        messagesDiv.appendChild(botRow);
        streamStarted = true;
    };

    const ensureCandidateCards = () => {
        if (!streamCandidates.length) return;
        if (candidateCardsEl?.isConnected) return;
        candidateCardsEl = renderCandidateCards(streamCandidates, messagesDiv, botMsg, {
            mode: streamMode,
            mall_name: streamMallName,
        });
    };

    const ensureClarificationChips = () => {
        if (!streamClarificationChips.length) return;
        if (clarificationChipsEl?.isConnected) return;
        clarificationChipsEl = renderClarificationChips(streamClarificationChips, messagesDiv, botMsg);
    };

    try {
        await chatRecommendStream(msg, currentSessionId, '南京', userLocation, {
            onMeta: (payload) => {
                // 必须先同步写入 candidates，避免 onDone 早于 await 侧栏刷新
                streamCandidates = payload.candidates || [];
                streamClarificationChips = payload.clarification_chips || [];
                streamMode = payload.mode || null;
                streamMallName = payload.mall_name || null;
                if (payload.session_id) {
                    const newSession = currentSessionId !== payload.session_id;
                    currentSessionId = payload.session_id;
                    sidebarListRefreshNeeded = newSession;
                    sidebarRefreshNeeded = !newSession;
                    highlightCurrentSession(currentSessionId);
                }
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
                ensureCandidateCards();
                ensureClarificationChips();
                if (currentSessionId && streamCandidates.length) {
                    recordTurnCandidates(currentSessionId, streamCandidates);
                }
                scrollToBottom();
            },
            onError: (message) => {
                throw new Error(message || 'AI 回复失败');
            },
        });

        if (!streamStarted) {
            removeThinking();
        }
        if (sidebarListRefreshNeeded) {
            _conversationListLoaded = false;
            void loadConversationList(true, { silent: true });
        } else if (sidebarRefreshNeeded) {
            void loadConversationList(true, { silent: true });
        }
        renderQuickQuestions();
    } catch (e) {
        removeThinking();
        if (streamStarted && botRow?.parentNode) {
            botRow.remove();
        }
        if (candidateCardsEl?.parentNode) {
            candidateCardsEl.remove();
        }
        if (clarificationChipsEl?.parentNode) {
            clarificationChipsEl.remove();
        }
        if (e.message === 'UNAUTHORIZED') {
            showToast('登录已过期，请重新登录');
            document.getElementById('authModal').style.display = 'flex';
            return;
        }
        appendChatBubble(messagesDiv, 'bot', '抱歉，AI 回复失败，请稍后重试');
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
