import { chatRecommend } from '../api.js';
import { showToast, escapeHtml } from '../utils.js';
import { isLoggedIn } from '../auth.js';

let currentSessionId = null;

async function sendMessage() {
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if (!msg) return;
    if (!isLoggedIn()) {
        showToast('请先登录使用AI助手');
        return;
    }
    const chatDiv = document.getElementById('chatMessages');
    chatDiv.innerHTML += `<div class="chat-message chat-user">${escapeHtml(msg)}</div>`;
    input.value = '';
    chatDiv.scrollTop = chatDiv.scrollHeight;
    try {
        const res = await chatRecommend(msg, currentSessionId);
        if (res.session_id) currentSessionId = res.session_id;
        const reply = res.reply || '抱歉，AI暂时无法回答';
        chatDiv.innerHTML += `<div class="chat-message chat-bot">🤖 ${escapeHtml(reply)}</div>`;
        if (res.candidates && res.candidates.length) {
            const candidatesHtml = '<div style="margin-top:8px;font-size:0.9rem;">🍽️ 推荐餐厅：' + res.candidates.map(c => c.name).join('、') + '</div>';
            chatDiv.innerHTML += candidatesHtml;
        }
        chatDiv.scrollTop = chatDiv.scrollHeight;
    } catch(e) {
        showToast('AI回复失败');
    }
}

export function initAIPage() {
    document.getElementById('sendChatBtn').onclick = sendMessage;
    document.getElementById('chatInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
}