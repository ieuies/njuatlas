/** 聊天背景：仅保存在本机 localStorage，按会话（好友）独立设置 */

import { t, tChatBgName } from './i18n.js';

const STORAGE_KEY = 'njuatlas-chat-bg';

export const CHAT_BG_PRESETS = [
    { id: 'default', css: null },
    { id: 'lavender', css: 'linear-gradient(160deg, #f5f3ff 0%, #ede9fe 40%, #ddd6fe 100%)' },
    { id: 'ocean', css: 'linear-gradient(160deg, #ecfeff 0%, #cffafe 45%, #a5f3fc 100%)' },
    { id: 'sunset', css: 'linear-gradient(160deg, #fff7ed 0%, #ffedd5 40%, #fed7aa 100%)' },
    { id: 'forest', css: 'linear-gradient(160deg, #f0fdf4 0%, #dcfce7 45%, #bbf7d0 100%)' },
    { id: 'night', css: 'linear-gradient(165deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)' },
    { id: 'paper', css: 'linear-gradient(180deg, #faf8f5 0%, #f3efe8 100%)' },
];

function readAll() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
        return {};
    }
}

function writeAll(map) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
        return true;
    } catch (e) {
        console.warn('聊天背景保存失败:', e?.message);
        return false;
    }
}

export function getChatBackground(peerId) {
    if (peerId == null) return null;
    const bg = readAll()[String(peerId)];
    if (!bg || bg.id === 'default') return null;
    return bg;
}

export function setChatBackground(peerId, bg) {
    if (peerId == null) return false;
    const all = readAll();
    const key = String(peerId);
    if (!bg || bg.id === 'default') {
        delete all[key];
    } else {
        all[key] = bg;
    }
    return writeAll(all);
}

export function clearChatBackground(peerId) {
    return setChatBackground(peerId, null);
}

export function applyChatBackground(el, peerId) {
    if (!el) return;
    const bg = getChatBackground(peerId);
    el.classList.toggle('has-custom-bg', Boolean(bg));
    el.style.background = '';
    el.style.backgroundImage = '';
    el.style.backgroundSize = '';
    el.style.backgroundPosition = '';
    el.style.backgroundRepeat = '';
    if (!bg) return;

    if (bg.type === 'custom' && bg.dataUrl) {
        el.style.backgroundImage = `url(${JSON.stringify(bg.dataUrl)})`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.style.backgroundRepeat = 'no-repeat';
        return;
    }

    const preset = CHAT_BG_PRESETS.find((p) => p.id === bg.id);
    if (preset?.css) {
        el.style.background = preset.css;
    }
}

export function compressChatBgImage(file, maxDim = 720, quality = 0.72) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const im = new Image();
            im.onload = () => {
                const scale = Math.min(1, maxDim / Math.max(im.width, im.height));
                const w = Math.max(1, Math.round(im.width * scale));
                const h = Math.max(1, Math.round(im.height * scale));
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                canvas.getContext('2d').drawImage(im, 0, 0, w, h);
                try {
                    resolve(canvas.toDataURL('image/jpeg', quality));
                } catch (e) {
                    reject(new Error('图片处理失败'));
                }
            };
            im.onerror = () => reject(new Error('图片加载失败'));
            im.src = reader.result;
        };
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(file);
    });
}

export function buildChatBgPanelHtml(peerId, visible = false) {
    const current = getChatBackground(peerId);
    const currentId = current?.type === 'preset' ? current.id : (current?.type === 'custom' ? 'custom' : 'default');

    const swatches = CHAT_BG_PRESETS.map((p) => {
        const active = currentId === p.id ? ' active' : '';
        const name = tChatBgName(p.id);
        const style = p.css
            ? `style="background:${p.css}"`
            : 'style="background:var(--bg-secondary)"';
        return `<button type="button" class="msg-chat-bg-swatch${active}" data-chat-bg-preset="${p.id}" data-peer-id="${peerId}" title="${name}" aria-label="${name}" ${style}></button>`;
    }).join('');

    return `
        <div class="msg-chat-bg-panel${visible ? ' is-open' : ''}" id="msgChatBgPanel" hidden>
            <div class="msg-chat-bg-panel-head">
                <span>${t('messages.chatBg')}</span>
                <button type="button" class="msg-chat-bg-close" id="msgChatBgClose" aria-label="${t('messages.close')}"><i class="fas fa-times"></i></button>
            </div>
            <p class="msg-chat-bg-hint">${t('messages.chatBgHint')}</p>
            <div class="msg-chat-bg-swatches">${swatches}</div>
            <div class="msg-chat-bg-actions">
                <button type="button" class="msg-mini-btn primary" id="msgChatBgUploadBtn" data-peer-id="${peerId}">
                    <i class="fas fa-upload"></i> ${t('messages.chatBgUpload')}
                </button>
                <button type="button" class="msg-mini-btn" data-chat-bg-reset="${peerId}">${t('messages.chatBgReset')}</button>
            </div>
        </div>
        <input type="file" id="msgChatBgFile" accept="image/jpeg,image/png,image/webp" hidden>`;
}
