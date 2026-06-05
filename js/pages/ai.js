import { chatRecommend } from '../api.js';
import { showToast } from '../utils.js';
import { isLoggedIn } from '../auth.js';

let currentSessionId = null;

/**
 * 去除 Markdown 标记，转为纯文本
 */
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

/**
 * 随机打乱数组（Fisher-Yates）
 */
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * 快捷问题模板库 — AI 每次从这里随机选取并变化
 */
const questionTemplates = [
    { base: '推荐一家{type}餐厅', slot: ['川菜', '湘菜', '粤菜', '江浙菜', '东北菜', '西北菜', '日料', '韩餐', '东南亚菜', '西餐', '火锅', '烧烤', '串串', '麻辣烫'] },
    { base: '南大附近有什么好吃的{type}', slot: ['早餐店', '面馆', '饺子馆', '奶茶店', '咖啡厅', '甜品店', '小吃摊', '夜宵摊', '快餐', '自助餐'] },
    { base: '我想去{type}，有推荐吗', slot: ['聚餐', '约会', '一个人吃饭', '请客', '吃夜宵', '吃早餐'] },
    { base: '有没有{type}的餐厅', slot: ['安静', '性价比高', '上菜快', '适合自习', '有包厢', '环境好', '便宜又好吃', '评分高'] },
    { base: '南大{type}附近有什么吃的', slot: ['仙林校区', '鼓楼校区', '南门', '北门', '汉口路', '珠江路'] },
];

/**
 * 从模板池随机生成若干个不同的问题
 */
function generateRandomQuestions(count = 4) {
    const shuffled = shuffle([...questionTemplates]);
    const questions = [];
    for (let i = 0; i < Math.min(count, shuffled.length); i++) {
        const tpl = shuffled[i];
        const slotVal = tpl.slot[Math.floor(Math.random() * tpl.slot.length)];
        questions.push(tpl.base.replace('{type}', slotVal));
    }
    return questions;
}

/** 渲染快捷提问按钮 */
function renderQuickQuestions() {
    const container = document.getElementById('quickQuestions');
    if (!container) return;
    container.innerHTML = '';
    const questions = generateRandomQuestions(4);
    questions.forEach(q => {
        const btn = document.createElement('button');
        btn.className = 'quick-q-btn';
        btn.textContent = q;
        btn.addEventListener('click', () => {
            const input = document.getElementById('chatInput');
            if (!input) return;
            input.value = q;
            sendMessage();
        });
        container.appendChild(btn);
    });
}

async function sendMessage() {
    const input = document.getElementById('chatInput');
    const chatDiv = document.getElementById('chatMessages');
    if (!input || !chatDiv) return;
    const msg = input.value.trim();
    if (!msg) return;
    if (!isLoggedIn()) {
        showToast('请先登录使用AI助手');
        return;
    }
    const userMsgDiv = document.createElement('div');
    userMsgDiv.className = 'chat-message chat-user';
    userMsgDiv.textContent = msg;
    chatDiv.appendChild(userMsgDiv);
    input.value = '';
    chatDiv.scrollTop = chatDiv.scrollHeight;
    try {
        const res = await chatRecommend(msg, currentSessionId);
        if (res.session_id) currentSessionId = res.session_id;
        const rawReply = res.reply || '抱歉，AI暂时无法回答';
        const cleanReply = stripMarkdown(rawReply);
        const botMsgDiv = document.createElement('div');
        botMsgDiv.className = 'chat-message chat-bot';
        botMsgDiv.textContent = '🤖 ' + cleanReply;
        chatDiv.appendChild(botMsgDiv);
        if (res.candidates && res.candidates.length) {
            const candDiv = document.createElement('div');
            candDiv.style.cssText = 'margin-top:8px;font-size:0.9rem;';
            candDiv.textContent = '🍽️ 推荐餐厅：' + res.candidates.map(c => c.name).join('、');
            chatDiv.appendChild(candDiv);
        }
        chatDiv.scrollTop = chatDiv.scrollHeight;
        // 发送消息后刷新快捷提问按钮
        renderQuickQuestions();
    } catch(e) {
        showToast('AI回复失败');
    }
}

export function initAIPage() {
    const sendBtn = document.getElementById('sendChatBtn');
    const input = document.getElementById('chatInput');
    if (!sendBtn || !input) return;
    sendBtn.onclick = sendMessage;
    if (input.dataset.aiReady !== 'true') {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });
        input.dataset.aiReady = 'true';
    }
    // 首次渲染快捷提问按钮
    renderQuickQuestions();
}

window.initAIPage = initAIPage;
