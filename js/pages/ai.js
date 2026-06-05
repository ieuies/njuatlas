import { chatRecommend } from '../api.js';
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
    questions.forEach(function (q) {
        const btn = document.createElement('button');
        btn.className = 'quick-q-btn';
        btn.textContent = q;
        btn.addEventListener('click', function () {
            const input = document.getElementById('chatInput');
            if (!input) return;
            input.value = q;
            sendMessage();
        });
        container.appendChild(btn);
    });
}

function hideWelcome() {
    const welcome = document.getElementById('aiWelcome');
    if (welcome) welcome.style.display = 'none';
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
    if (div) {
        requestAnimationFrame(function () { div.scrollTop = div.scrollHeight; });
    }
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

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
        if (res.session_id) currentSessionId = res.session_id;
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
            let html = '<div class="ai-candidates">';
            html += '<div class="ai-candidates-label"><i class="fas fa-utensils"></i> 推荐餐厅</div>';
            res.candidates.forEach(function (c) {
                html += '<div class="ai-candidate-item">';
                html += '<span class="ai-candidate-name">' + escapeHtml(c.name) + '</span>';
                html += '<span class="ai-candidate-meta">';
                html += '<span>⭐ ' + escapeHtml(c.rating) + '</span>';
                html += '<span>💰 ' + escapeHtml(c.cost) + '</span>';
                html += '</span></div>';
            });
            html += '</div>';
            candDiv.innerHTML = html;
            messagesDiv.appendChild(candDiv);
        }

        scrollToBottom();
        renderQuickQuestions();
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

/**
 * 通用粒子飘落特效：为指定容器 id 注入彩色粒子。
 * @param {string} containerId
 */
export function initParticlesForContainer(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    const colors = ['#7c3aed','#8b5cf6','#a78bfa','#c084fc','#e9d5ff','#f472b6','#818cf8','#c4b5fd'];
    const count = window.innerWidth < 600 ? 20 : 32;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'ai-particle';
        // 粒子初始垂直位置设在容器上方外，配合 overflow:hidden 做到从顶部外掉落
        const startTop = -(5 + Math.random() * 20) + 'vh';
        p.style.top = startTop;
        p.style.left = Math.random() * 100 + '%';
        p.style.width = (3 + Math.random() * 6) + 'px';
        p.style.height = (3 + Math.random() * 6) + 'px';
        p.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
        p.style.background = colors[Math.floor(Math.random() * colors.length)];
        p.style.animationDuration = (8 + Math.random() * 14) + 's';
        p.style.animationDelay = Math.random() * 10 + 's';
        p.style.opacity = (0.15 + Math.random() * 0.35);
        frag.appendChild(p);
    }
    container.appendChild(frag);
}

export function initAIPage() {
    const sendBtn = document.getElementById('sendChatBtn');
    const input = document.getElementById('chatInput');
    if (!sendBtn || !input) return;

    sendBtn.onclick = sendMessage;

    if (input.dataset.aiReady !== 'true') {
        input.addEventListener('keypress', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        input.dataset.aiReady = 'true';
    }

    renderQuickQuestions();
    initParticlesForContainer('aiParticles');
}

window.initAIPage = initAIPage;
