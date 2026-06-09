export const DEFAULT_BUBBLE_STYLE = 'atlas-classic';

// 先内置几种可用主题；后续你提供素材时，直接替换/新增这里即可。
export const BUBBLE_THEME_PRESETS = [
    {
        id: 'nailong-style-1',
        name: '奶龙·小黄鸭',
        // 非九宫格：不强行限定边框形状，直接用原图做自由背景。
        bg: '#f0dc7c',
        image: "url('image/chat-bubbles/nailong-style-1.jpg')",
        imageSize: '185% 185%',
        imagePosition: '22% 42%',
        imageRepeat: 'no-repeat',
        frameWidth: '0px',
        radius: '0px',
        tailRadiusThem: '0px',
        tailRadiusMe: '0px',
        minWidth: '72px',
        minHeight: '42px',
        color: '#2f2a1d',
        border: 'transparent',
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
        `--bubble-frame-width:${theme.frameWidth || '1px'}`,
        `--bubble-radius:${theme.radius || '14px'}`,
        `--bubble-tail-radius-them:${theme.tailRadiusThem || '4px'}`,
        `--bubble-tail-radius-me:${theme.tailRadiusMe || '4px'}`,
        `--bubble-min-width:${theme.minWidth || '0'}`,
        `--bubble-min-height:${theme.minHeight || '0'}`,
        `--bubble-image:${theme.image || 'none'}`,
        `--bubble-image-size:${theme.imageSize || 'cover'}`,
        `--bubble-image-position:${theme.imagePosition || 'center'}`,
        `--bubble-image-repeat:${theme.imageRepeat || 'no-repeat'}`,
        `--bubble-nine-source:${theme.nineSource || 'none'}`,
        `--bubble-nine-slice:${theme.nineSlice || '0'}`,
        `--bubble-nine-width:${theme.nineWidth || '1'}`,
        `--bubble-nine-outset:${theme.nineOutset || '0'}`,
        `--bubble-nine-repeat:${theme.nineRepeat || 'stretch'}`,
        `--bubble-bg:${theme.bg || 'transparent'}`,
    ].join(';');
}
