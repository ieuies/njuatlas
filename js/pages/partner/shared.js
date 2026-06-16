import { formatDate, parseApiDate, beijingDateKey, BEIJING_TZ, escapeHtml, wgs84ToGcj02 } from '../../utils.js';
import { getUser } from '../../auth.js';
import { t, tPartnerCategory } from '../../i18n.js';

export const PAGE_SIZE = 9;
export const LIST_CACHE_TTL_MS = 45000;
/** 已完整加载（触底无更多）的列表缓存有效期 */
export const FULL_LIST_CACHE_TTL_MS = 30 * 60 * 1000;
export const LIST_RENDER_BATCH = 6;

/** 列表内存缓存：key -> { at, posts, hasMore } */
export const partnerListCache = new Map();

export function partnerListCacheKey(category, searchQuery, page) {
    const user = getUser();
    const userKey = user?.id ?? user?.user_id ?? 'anon';
    return `${userKey}|nearby|${category}|${searchQuery}|${page}`;
}

/** 跨模块共享可变状态（import 的 let 绑定在其它模块里只读，须用对象属性） */
export const partnerStore = {
    allPartnersData: [],
    partnersData: [],
    currentCategory: 'all',
    searchQuery: '',
    currentPage: 1,
    hasMore: true,
    isLoading: false,
    modalDuration: 'short',
    modalUrgency: 'now',
    modalLocationCoords: null,
    partnerDataLoaded: false,
    partnerPageInitialized: false,
    filtersInited: false,
    currentMapParent: null,
    _prefetchPromise: null,
};

// 校区坐标映射（WGS-84 → 高德 GCJ-02 转换前）
const CAMPUS_COORDS = {
    '鼓楼': [118.780, 32.058],
    '仙林': [118.954, 32.114],
    '浦口': [118.652, 32.157],
    '苏州': [120.385, 31.355],
};
export function getMapCenter() {
    const user = getUser();
    const campus = user?.campus || '';
    const coords = CAMPUS_COORDS[campus];
    if (coords) return wgs84ToGcj02(coords[0], coords[1]);
    // 默认：鼓楼校区
    return wgs84ToGcj02(118.780, 32.058);
}

// 动态分类颜色（根据标签名生成 HSL 色相）
const categoryColorCache = {};
export function categoryStyle(cat) {
    if (!cat) return { color: '#999', icon: '', tagClass: 'tag-default' };
    if (!categoryColorCache[cat]) {
        const hue = [...cat].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
        categoryColorCache[cat] = {
            color: `hsl(${hue}, 65%, 50%)`,
            icon: '',
            tagClass: 'tag-dynamic',
        };
    }
    return categoryColorCache[cat];
}

const TYPE_ICONS = {
    '饭搭子': 'fa-utensils',
    '运动搭子': 'fa-futbol',
    '学习搭子': 'fa-book',
    '游戏搭子': 'fa-gamepad',
    '电影搭子': 'fa-film',
    '旅游搭子': 'fa-plane',
    '音乐搭子': 'fa-music',
    '摄影搭子': 'fa-camera',
    '其他': 'fa-ellipsis',
};
export function typeIcon(category) {
    return TYPE_ICONS[category] || 'fa-user-group';
}
export function typeLabel(post) {
    const icon = typeIcon(post.category);
    const suffix = post.type === 'event' ? '活动组局' : '长期招募';
    return `<i class="fas ${icon}" aria-hidden="true"></i> ${suffix}`;
}
export function categoryChipHtml(c) {
    const icon = c.icon ? `<i class="fas ${c.icon}" aria-hidden="true"></i> ` : '';
    const label = c.category === 'all' ? t('cat.all') : tPartnerCategory(c.category);
    return `${icon}${escapeHtml(label)}`;
}

export function isCurrentUserOwner(item) {
    const user = getUser();
    if (!item || !user) return Boolean(item?.is_owner);
    const currentId = user.id ?? user.user_id;
    const ownerId = item.user_id ?? item.author_id ?? item.owner_id ?? item.user?.id;
    return Boolean(item.is_owner || (currentId != null && ownerId != null && String(currentId) === String(ownerId)));
}

/** 是否应对当前用户展示「已满员」（已报名用户仍可取消） */
export function isPostParticipationFull(p) {
    if (typeof p.is_full === 'boolean') return p.is_full;
    if (typeof p.isFull === 'boolean') return p.isFull;
    const members = p.members ?? p.participant_count ?? 0;
    const slots = p.slots ?? p.max_participants ?? 2;
    if (members < slots) return false;
    const status = p.participationStatus ?? p.participation_status ?? null;
    return status !== 'going';
}

/** 将后端帖子格式映射为前端卡片和地图所需的字段 */
export function mapPost(p) {
    const mapped = {
        id: p.id,
        type: p.type,
        category: (p.tags && p.tags.length > 0) ? p.tags[0] : '其他',
        tags: p.tags || [],
        title: p.title,
        description: p.content,
        location: p.location_name || '',
        lnglat: p.location ? p.location.split(',').map(Number) : null,
        urgency: p.urgency || null,
        time: formatPostTime(p.event_time, p.urgency, p.event_end_time),
        eventTime: p.event_time || null,
        eventEndTime: p.event_end_time || null,
        publisher: p.username || '匿名同学',
        publisherId: p.user_id,
        publisherAvatar: p.avatar_url || '',
        coverImage: p.cover_image || '',
        members: p.participant_count || 0,
        slots: p.max_participants || 2,
        budget: p.budget || '',
        contact: p.contact || '',
        views: p.view_count || 0,
        likeCount: p.like_count || 0,
        favoriteCount: p.favorite_count || 0,
        commentCount: p.comment_count || 0,
        hotScore: p.hot_score || 0,
        isLiked: p.is_liked || false,
        isFavorited: p.is_favorited || false,
        isOwner: isCurrentUserOwner(p),
        participationStatus: p.participation_status,
        isFull: typeof p.is_full === 'boolean' ? p.is_full : undefined,
        createdAt: formatDate(p.created_at),
        nearby: '',
    };
    if (typeof mapped.isFull !== 'boolean') {
        mapped.isFull = isPostParticipationFull(mapped);
    }
    return mapped;
}

export function formatPostTime(iso, urgency, endIso = null) {
    if (urgency === 'now') return '立即';
    if (urgency === 'long_term') return '长期有效';
    if (!iso) return urgency === 'scheduled' ? '已设定' : '';
    const d = parseApiDate(iso);
    if (!d || Number.isNaN(d.getTime())) return '';
    const end = endIso ? parseApiDate(endIso) : null;
    const todayKey = beijingDateKey(new Date());
    const eventKey = beijingDateKey(d);
    const timePart = d.toLocaleString('zh-CN', {
        timeZone: BEIJING_TZ,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    const endTimePart = end && !Number.isNaN(end.getTime()) ? end.toLocaleString('zh-CN', {
        timeZone: BEIJING_TZ,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }) : null;
    const endFull = end && !Number.isNaN(end.getTime()) ? end.toLocaleString('zh-CN', {
        timeZone: BEIJING_TZ,
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hour12: false,
    }) : null;
    const endKey = end && !Number.isNaN(end.getTime()) ? beijingDateKey(end) : null;
    const full = d.toLocaleString('zh-CN', {
        timeZone: BEIJING_TZ,
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hour12: false,
    });
    if (eventKey === todayKey) {
        if (!endTimePart) return `今天 ${timePart}`;
        return endKey && endKey !== eventKey ? `今天 ${timePart} - ${endFull}` : `今天 ${timePart}-${endTimePart}`;
    }
    const [y, m, day] = todayKey.split('-').map(Number);
    const tomorrowKey = new Date(Date.UTC(y, m - 1, day + 1)).toISOString().slice(0, 10);
    if (eventKey === tomorrowKey) {
        if (!endTimePart) return `明天 ${timePart}`;
        return endKey && endKey !== eventKey ? `明天 ${timePart} - ${endFull}` : `明天 ${timePart}-${endTimePart}`;
    }
    if (!endTimePart) return full;
    return endKey && endKey !== eventKey ? `${full} - ${endFull}` : `${full}-${endTimePart}`;
}

// ============================================================
// 工具函数
// ============================================================
export function safeHtmlWithBreaks(str) {
    if (!str) return '';
    let safe = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    safe = safe.replace(/\n/g, '<br>');
    return safe;
}

export function debounce(fn, delay) {
    let timer = null;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}