import { chatRecommendStream } from './api.js';
import { isLoggedIn } from './auth.js';
import { showToast } from './utils.js';

const BOT_BASE = 'image/bot';
const IMAGE_IDLE = `${BOT_BASE}/${encodeURIComponent('蓝鲸.png')}`;
const IMAGE_SHY = `${BOT_BASE}/${encodeURIComponent('害羞.png')}`;
const IMAGE_WAVE = `${BOT_BASE}/${encodeURIComponent('打招呼.png')}`;
const COMPANION_VERSION = '6';
const POS_STORAGE_KEY = 'njuatlas-companion-pos';
const SESSION_STORAGE_KEY = 'njuatlas-companion-session-id';
const DRAG_THRESHOLD = 10;
const AUTO_SHOW_MS = 3000;
const AUTO_GAP_MS = 2000;
const AUTO_RESUME_MS = 3000;
const WAVE_INTERVAL_MS = 4000;
const WAVE_HOLD_MS = 2500;
const GUEST_TEXT = '登录后就能和我聊天啦～';

const IDLE_LINES = [
    '嗨～我是小鲸灵，点我可以聊天哦！',
    '今天想吃什么？说个口味我帮你挑～',
    '仙林、鼓楼、浦口周边好店我都熟！',
    '找不到搭子？问我「有什么饭搭子」～',
    '附近有什么奶茶、咖啡，问我就行～',
    '周末不知道去哪？我可以给你出主意～',
    '写个「川菜」「火锅」，我帮你搜店～',
    '想组局？去「找搭子」或问我查活动～',
];

let rootEl = null;
let bubbleEl = null;
let bubbleTextEl = null;
let bubbleCloseBtn = null;
let chatEl = null;
let inputEl = null;
let sendBtn = null;
let figureEl = null;
let idleImgEl = null;
let shyImgEl = null;
let waveImgEl = null;

let sessionId = null;
let isSending = false;
let isOpen = false;
let isHovered = false;
let currentPose = 'idle';

let dragState = null;
let autoCycleTimer = null;
let waveCycleTimer = null;
let waveHoldTimer = null;
let autoLineIndex = 0;

function stripMarkdown(text) {
    return String(text || '')
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

function loadSessionId() {
    try {
        sessionId = localStorage.getItem(SESSION_STORAGE_KEY);
    } catch {
        sessionId = null;
    }
}

function saveSessionId(id) {
    sessionId = id || null;
    try {
        if (sessionId) localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
        else localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
        // ignore quota errors
    }
}

function getSafeBounds() {
    const rect = rootEl?.getBoundingClientRect();
    const width = rect?.width || 148;
    const height = rect?.height || 200;
    const margin = 8;
    const bottomInset = window.innerWidth <= 768
        ? (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--atlas-bottombar'), 10) || 66) + margin
        : margin;
    const topInset = margin;
    return {
        minX: margin,
        minY: topInset,
        maxX: Math.max(margin, window.innerWidth - width - margin),
        maxY: Math.max(topInset, window.innerHeight - height - bottomInset),
    };
}

function clampPosition(x, y) {
    const bounds = getSafeBounds();
    return {
        x: Math.min(bounds.maxX, Math.max(bounds.minX, x)),
        y: Math.min(bounds.maxY, Math.max(bounds.minY, y)),
    };
}

function applyPosition(x, y) {
    if (!rootEl) return;
    rootEl.style.left = `${x}px`;
    rootEl.style.top = `${y}px`;
    rootEl.style.right = 'auto';
    rootEl.style.bottom = 'auto';
}

function savePosition(x, y) {
    try {
        localStorage.setItem(POS_STORAGE_KEY, JSON.stringify({ x, y }));
    } catch {
        // ignore
    }
}

function restorePosition() {
    if (!rootEl) return;
    try {
        const raw = localStorage.getItem(POS_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
                const pos = clampPosition(parsed.x, parsed.y);
                applyPosition(pos.x, pos.y);
                return;
            }
        }
    } catch {
        // fall through to default
    }
    placeDefaultPosition();
}

function placeDefaultPosition() {
    if (!rootEl) return;
    rootEl.style.left = 'auto';
    rootEl.style.top = 'auto';
    rootEl.style.right = '16px';
    rootEl.style.bottom = 'calc(var(--atlas-bottombar, 66px) + 20px)';
}

function canRunAutoCycle() {
    return !isOpen && !isSending;
}

function canRunWaveCycle() {
    return canRunAutoCycle() && !isHovered && !dragState;
}

function stopAutoCycle() {
    if (autoCycleTimer) {
        clearTimeout(autoCycleTimer);
        autoCycleTimer = null;
    }
}

function stopWavePose() {
    if (waveHoldTimer) {
        clearTimeout(waveHoldTimer);
        waveHoldTimer = null;
    }
    rootEl?.classList.remove('is-waving');
}

function stopWaveCycle() {
    if (waveCycleTimer) {
        clearTimeout(waveCycleTimer);
        waveCycleTimer = null;
    }
    stopWavePose();
}

function scheduleWaveCycle(delay = WAVE_INTERVAL_MS) {
    stopWaveCycle();
    if (!canRunWaveCycle()) return;
    waveCycleTimer = window.setTimeout(playWaveOnce, delay);
}

function playWaveOnce() {
    waveCycleTimer = null;
    if (!canRunWaveCycle() || !rootEl) return;

    rootEl.classList.add('is-waving');
    waveHoldTimer = window.setTimeout(() => {
        waveHoldTimer = null;
        rootEl?.classList.remove('is-waving');
        scheduleWaveCycle(WAVE_INTERVAL_MS);
    }, WAVE_HOLD_MS);
}

function hideBubble() {
    bubbleEl?.classList.remove('is-visible');
}

function showUserBubble(text, { thinking = false } = {}) {
    if (!bubbleTextEl || !bubbleEl) return;
    stopAutoCycle();
    stopWaveCycle();
    bubbleTextEl.textContent = text;
    bubbleTextEl.parentElement?.classList.toggle('is-thinking', thinking);
    bubbleEl.classList.add('is-user', 'is-visible');
}

function showAutoBubble(text) {
    if (!bubbleTextEl || !bubbleEl || !canRunAutoCycle()) return;
    bubbleTextEl.textContent = text;
    bubbleTextEl.parentElement?.classList.remove('is-thinking');
    bubbleEl.classList.remove('is-user');
    bubbleEl.classList.add('is-visible');
}

function hideAutoBubble() {
    if (!bubbleEl || bubbleEl.classList.contains('is-user')) return;
    hideBubble();
}

function scheduleAutoCycle(delay = AUTO_GAP_MS) {
    stopAutoCycle();
    if (!canRunAutoCycle()) return;
    autoCycleTimer = window.setTimeout(runAutoCycleStep, delay);
}

function runAutoCycleStep() {
    autoCycleTimer = null;
    if (!canRunAutoCycle()) return;

    const text = IDLE_LINES[autoLineIndex % IDLE_LINES.length];
    autoLineIndex += 1;
    showAutoBubble(text);

    autoCycleTimer = window.setTimeout(() => {
        hideAutoBubble();
        scheduleAutoCycle(AUTO_GAP_MS);
    }, AUTO_SHOW_MS);
}

function closeCompanionSession({ resumeAuto = true } = {}) {
    stopAutoCycle();
    stopWaveCycle();
    isOpen = false;
    rootEl?.classList.remove('is-open');
    applyCompanionPose();
    hideBubble();
    bubbleEl?.classList.remove('is-user');
    bubbleTextEl?.parentElement?.classList.remove('is-thinking');
    if (resumeAuto) {
        scheduleAutoCycle(AUTO_RESUME_MS);
        scheduleWaveCycle(AUTO_RESUME_MS);
    }
}

function shouldUseShyPose() {
    return isOpen || isHovered;
}

function applyCompanionPose() {
    if (!rootEl) return;
    const shy = shouldUseShyPose();
    const nextPose = shy ? 'shy' : 'idle';
    if (currentPose === nextPose) return;
    currentPose = nextPose;
    rootEl.classList.toggle('is-shy', shy);
}

function setOpen(nextOpen) {
    if (!nextOpen) {
        closeCompanionSession();
        return;
    }

    stopAutoCycle();
    stopWaveCycle();
    isOpen = true;
    rootEl?.classList.add('is-open');
    applyCompanionPose();
    requestAnimationFrame(() => inputEl?.focus());
}

async function resolveUserLocation() {
    if (!navigator.geolocation) return null;
    try {
        const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                timeout: 5000,
                maximumAge: 300000,
            });
        });
        return `${pos.coords.longitude},${pos.coords.latitude}`;
    } catch {
        return null;
    }
}

async function sendCompanionMessage() {
    if (!inputEl || isSending) return;
    const msg = inputEl.value.trim();
    if (!msg) return;

    if (!isLoggedIn()) {
        showUserBubble(GUEST_TEXT);
        document.getElementById('authModal')?.style.setProperty('display', 'flex');
        return;
    }

    stopAutoCycle();
    stopWaveCycle();
    isSending = true;
    sendBtn.disabled = true;
    inputEl.disabled = true;
    inputEl.value = '';

    showUserBubble('思考中…', { thinking: true });

    let streamText = '';
    const userLocation = await resolveUserLocation();

    try {
        await chatRecommendStream(msg, sessionId, '南京', userLocation, {
            onMeta: (payload) => {
                if (payload.session_id) saveSessionId(payload.session_id);
            },
            onToken: (text) => {
                streamText += text;
                showUserBubble(stripMarkdown(streamText));
            },
            onDone: (payload) => {
                const finalReply = stripMarkdown(payload.reply || streamText || '暂时想不出好主意，换个问法试试？');
                showUserBubble(finalReply);
            },
            onError: (message) => {
                throw new Error(message || 'AI 回复失败');
            },
        });
    } catch (err) {
        if (err.message === 'UNAUTHORIZED') {
            showToast('登录已过期，请重新登录');
            document.getElementById('authModal')?.style.setProperty('display', 'flex');
            showUserBubble(GUEST_TEXT);
        } else {
            showUserBubble('抱歉，刚刚没连上，稍后再试～');
        }
    } finally {
        isSending = false;
        sendBtn.disabled = false;
        inputEl.disabled = false;
        inputEl.focus();
    }
}

function onPointerDown(event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    if (event.target.closest('.site-companion-chat')) return;
    if (event.target.closest('.site-companion-bubble')) return;

    const rect = rootEl.getBoundingClientRect();
    dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: rect.left,
        originY: rect.top,
        moved: false,
    };

    isHovered = true;
    applyCompanionPose();
    stopWaveCycle();
    rootEl.classList.add('is-dragging');
    figureEl?.setPointerCapture?.(event.pointerId);
    event.preventDefault();
}

function onPointerMove(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

    dragState.moved = true;
    const pos = clampPosition(dragState.originX + dx, dragState.originY + dy);
    applyPosition(pos.x, pos.y);
}

function onPointerUp(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    rootEl.classList.remove('is-dragging');
    figureEl?.releasePointerCapture?.(event.pointerId);

    if (dragState.moved) {
        const rect = rootEl.getBoundingClientRect();
        savePosition(rect.left, rect.top);
        isHovered = false;
        applyCompanionPose();
        if (canRunWaveCycle()) scheduleWaveCycle(WAVE_INTERVAL_MS);
    } else {
        setOpen(!isOpen);
    }

    dragState = null;
}

function onFigureMouseEnter() {
    isHovered = true;
    applyCompanionPose();
    stopWaveCycle();
}

function onFigureMouseLeave() {
    isHovered = false;
    applyCompanionPose();
    if (canRunWaveCycle()) scheduleWaveCycle(WAVE_INTERVAL_MS);
}

function onWindowResize() {
    if (!rootEl) return;
    const rect = rootEl.getBoundingClientRect();
    if (rootEl.style.left && rootEl.style.left !== 'auto') {
        const pos = clampPosition(rect.left, rect.top);
        applyPosition(pos.x, pos.y);
        savePosition(pos.x, pos.y);
    } else {
        placeDefaultPosition();
    }
}

function buildCompanionDom() {
    rootEl = document.createElement('div');
    rootEl.id = 'siteCompanion';
    rootEl.className = 'site-companion';
    rootEl.dataset.companionVersion = COMPANION_VERSION;
    rootEl.setAttribute('role', 'complementary');
    rootEl.setAttribute('aria-label', '校园助手小鲸灵');

    const speechEl = document.createElement('div');
    speechEl.className = 'site-companion-speech';

    chatEl = document.createElement('div');
    chatEl.className = 'site-companion-chat';

    inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.placeholder = '问我点什么…';
    inputEl.maxLength = 500;
    inputEl.autocomplete = 'off';

    sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.textContent = '发送';

    chatEl.appendChild(inputEl);
    chatEl.appendChild(sendBtn);

    bubbleEl = document.createElement('div');
    bubbleEl.className = 'site-companion-bubble';

    const bubbleInner = document.createElement('div');
    bubbleInner.className = 'site-companion-bubble-inner';

    bubbleCloseBtn = document.createElement('button');
    bubbleCloseBtn.type = 'button';
    bubbleCloseBtn.className = 'site-companion-bubble-close';
    bubbleCloseBtn.setAttribute('aria-label', '关闭对话');
    bubbleCloseBtn.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';

    bubbleTextEl = document.createElement('div');
    bubbleTextEl.className = 'site-companion-bubble-text';

    bubbleInner.appendChild(bubbleCloseBtn);
    bubbleInner.appendChild(bubbleTextEl);
    bubbleEl.appendChild(bubbleInner);

    speechEl.appendChild(chatEl);
    speechEl.appendChild(bubbleEl);

    figureEl = document.createElement('div');
    figureEl.className = 'site-companion-figure';

    const stackEl = document.createElement('div');
    stackEl.className = 'site-companion-sprite-stack';

    idleImgEl = document.createElement('img');
    idleImgEl.className = 'site-companion-sprite site-companion-sprite--idle';
    idleImgEl.src = IMAGE_IDLE;
    idleImgEl.alt = '小鲸灵';
    idleImgEl.decoding = 'async';
    idleImgEl.loading = 'eager';

    shyImgEl = document.createElement('img');
    shyImgEl.className = 'site-companion-sprite site-companion-sprite--shy';
    shyImgEl.src = IMAGE_SHY;
    shyImgEl.alt = '';
    shyImgEl.decoding = 'async';
    shyImgEl.loading = 'eager';
    shyImgEl.setAttribute('aria-hidden', 'true');

    waveImgEl = document.createElement('img');
    waveImgEl.className = 'site-companion-sprite site-companion-sprite--wave';
    waveImgEl.src = IMAGE_WAVE;
    waveImgEl.alt = '';
    waveImgEl.decoding = 'async';
    waveImgEl.loading = 'eager';
    waveImgEl.setAttribute('aria-hidden', 'true');

    stackEl.appendChild(idleImgEl);
    stackEl.appendChild(shyImgEl);
    stackEl.appendChild(waveImgEl);
    figureEl.appendChild(stackEl);

    rootEl.appendChild(speechEl);
    rootEl.appendChild(figureEl);
    document.body.appendChild(rootEl);
}

function bindEvents() {
    figureEl.addEventListener('pointerdown', onPointerDown);
    figureEl.addEventListener('pointermove', onPointerMove);
    figureEl.addEventListener('pointerup', onPointerUp);
    figureEl.addEventListener('pointercancel', onPointerUp);
    figureEl.addEventListener('mouseenter', onFigureMouseEnter);
    figureEl.addEventListener('mouseleave', onFigureMouseLeave);

    bubbleCloseBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        closeCompanionSession();
    });

    sendBtn.addEventListener('click', sendCompanionMessage);
    inputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            sendCompanionMessage();
        }
    });

    document.addEventListener('click', (event) => {
        if (!isOpen || !rootEl) return;
        if (rootEl.contains(event.target)) return;
        closeCompanionSession();
    });

    window.addEventListener('resize', onWindowResize);
}

function preloadCompanionImages() {
    return Promise.all([IMAGE_IDLE, IMAGE_SHY, IMAGE_WAVE].map((src) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = src;
    })));
}

export function initCompanion() {
    const existing = document.getElementById('siteCompanion');
    if (existing?.dataset.companionVersion === COMPANION_VERSION) return;
    existing?.remove();

    loadSessionId();
    buildCompanionDom();
    bindEvents();
    restorePosition();
    applyCompanionPose();
    void preloadCompanionImages();
    scheduleAutoCycle(AUTO_GAP_MS);
    scheduleWaveCycle(WAVE_INTERVAL_MS);
}
