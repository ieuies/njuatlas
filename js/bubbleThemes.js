export const DEFAULT_BUBBLE_STYLE = 'atlas-classic';

// 先内置几种可用主题；后续你提供素材时，直接替换/新增这里即可。
export const BUBBLE_THEME_PRESETS = [
    {
        id: 'nailong-style-1',
        name: '奶龙·小黄鸭',
        // 使用整张图拉伸作为气泡底图（保留眼睛等图案元素）
        image: "url('image/chat-bubbles/nailong-style-1.png')",
        imageSize: '100% 100%',
        imagePosition: 'center',
        imageRepeat: 'no-repeat',
        color: '#2f2a1d',
        border: 'rgba(125, 110, 43, 0.45)',
    },
    {
        id: 'atlas-classic',
        name: '默认样式',
        bg: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
        color: '#ffffff',
        border: 'rgba(255,255,255,0.16)',
    },
    {
        id: 'atlas-ocean',
        name: '海盐蓝',
        bg: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)',
        color: '#ffffff',
        border: 'rgba(255,255,255,0.16)',
    },
    {
        id: 'atlas-sunset',
        name: '晚霞橙',
        bg: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
        color: '#ffffff',
        border: 'rgba(255,255,255,0.16)',
    },
    {
        id: 'atlas-ink',
        name: '墨黑',
        bg: 'linear-gradient(135deg, #334155 0%, #1f2937 100%)',
        color: '#ffffff',
        border: 'rgba(255,255,255,0.12)',
    },
];

const PRESET_MAP = new Map(BUBBLE_THEME_PRESETS.map((t) => [t.id, t]));

export function normalizeBubbleStyle(styleId) {
    if (!styleId || typeof styleId !== 'string') return DEFAULT_BUBBLE_STYLE;
    return PRESET_MAP.has(styleId) ? styleId : DEFAULT_BUBBLE_STYLE;
}

export function resolveBubbleTheme(styleId) {
    return PRESET_MAP.get(normalizeBubbleStyle(styleId)) || PRESET_MAP.get(DEFAULT_BUBBLE_STYLE);
}

export function bubbleThemeCssVars(styleId) {
    const theme = resolveBubbleTheme(styleId);
    return [
        `--bubble-color:${theme.color}`,
        `--bubble-border:${theme.border}`,
        `--bubble-image:${theme.image || 'none'}`,
        `--bubble-image-size:${theme.imageSize || 'cover'}`,
        `--bubble-image-position:${theme.imagePosition || 'center'}`,
        `--bubble-image-repeat:${theme.imageRepeat || 'no-repeat'}`,
        `--bubble-bg:${theme.bg || 'transparent'}`,
    ].join(';');
}
