/** 系统 UI 国际化：仅翻译界面，不翻译用户发布的帖子内容 */

const LOCALE_KEY = 'njuatlas-locale';
const DEFAULT_LOCALE = 'zh';

const MESSAGES = {
    zh: {
        'nav.home': '首页',
        'nav.partner': '找搭子',
        'nav.ai': 'AI助手',
        'nav.guide': '吃喝玩乐',
        'nav.profile': '个人',
        'nav.messages': '消息',
        'nav.fullMap': '组局地图',
        'nav.guideShort': '指南',
        'nav.profileShort': '我的',
        'common.login': '登录',
        'common.logout': '退出登录',
        'common.save': '保存',
        'common.cancel': '取消',
        'common.loading': '加载中...',
        'common.all': '全部',
        'lang.switch': 'English',
        'lang.label': '语言',
        'theme.dark': '切换夜间模式',
        'theme.light': '切换日间模式',
        'brand.home': 'NJUATLAS 首页',
        'home.subtitle': '南大图谱 · 南朋友搭子平台',
        'home.btnPartner': '开始找搭子',
        'home.btnGuide': '看看周边',
        'home.feat1Title': '找搭子',
        'home.feat1Desc': '按分类浏览饭搭子、运动搭子、学习搭子等，一键加入感兴趣的活动。',
        'home.feat2Title': '吃喝玩乐',
        'home.feat2Desc': '收录南大周边餐饮、娱乐、学习场所，支持分类筛选与 AI 推荐。',
        'home.feat3Title': '个人空间',
        'home.feat3Desc': '管理个人资料，查看发布的组局、评论、收藏与活动记录。',
        'home.feat4Title': '组局地图',
        'home.feat4Desc': '高德地图展示附近组局分布，点击标记查看详情并快速参与。',
        'ai.newChat': '新对话',
        'ai.batchManage': '批量管理',
        'ai.batchDelete': '删除',
        'ai.batchCancel': '取消',
        'ai.loadingHistory': '加载历史对话...',
        'ai.welcomeTitle': '你好，我是南大图谱 AI 助手',
        'ai.welcomeDesc': '可以问我南大周边吃喝玩乐的问题~',
        'ai.welcomeHint': '试试点击下方推荐问题，或直接输入',
        'ai.inputPlaceholder': '输入你的问题，如「南大附近有什么好吃的」',
        'ai.send': '发送',
        'partner.searchPlaceholder': '搜索搭子帖子：标题、地点、标签…',
        'partner.searchClear': '清除搜索',
        'partner.nearbyMap': '附近组局',
        'partner.fullMap': '全屏地图',
        'partner.createGroup': '发起组局',
        'partner.viewMap': '查看地图',
        'partner.legend.food': '饭搭子',
        'partner.legend.sport': '运动',
        'partner.legend.game': '游戏',
        'partner.legend.movie': '电影',
        'partner.legend.study': '学习',
        'partner.legend.other': '其他',
        'cat.all': '全部',
        'cat.food': '饭搭子',
        'cat.sport': '运动搭子',
        'cat.study': '学习搭子',
        'cat.game': '游戏搭子',
        'cat.movie': '电影搭子',
        'cat.travel': '旅游搭子',
        'cat.music': '音乐搭子',
        'cat.photo': '摄影搭子',
        'cat.other': '其他',
        'guide.title': '南大周边 · 吃喝玩乐',
        'guide.subtitle': '发现校园附近的宝藏店铺与好去处',
        'guide.refresh': '刷新数据',
        'guide.loading': '加载精彩推荐中...',
        'guide.cat.food': '美食',
        'guide.cat.coffee': '咖啡饮品',
        'guide.cat.fun': '休闲娱乐',
        'guide.cat.fitness': '运动健身',
        'guide.cat.shop': '购物商圈',
        'guide.cat.park': '景点公园',
        'profile.center': '个人中心',
        'profile.edit': '编辑资料',
        'profile.defaultBio': '这个人很懒，什么都没写...',
        'profile.verifyEmail': '验证邮箱',
        'profile.statPosts': '发布',
        'profile.statFriends': '好友',
        'profile.statLikes': '获赞',
        'profile.statComments': '评论',
        'profile.statFavorites': '收藏',
        'profile.tabPosts': '我发布的',
        'profile.tabComments': '我的评论',
        'profile.tabFavorites': '我的收藏',
        'profile.tabActivities': '我的活动',
        'profile.editTitle': '编辑资料',
        'profile.username': '用户名',
        'profile.bio': '个人简介',
        'profile.tags': '兴趣标签（用逗号分隔）',
        'profile.campus': '所在校区',
        'profile.campusNone': '不设置',
        'profile.changePassword': '修改密码（留空则不修改）',
        'profile.oldPassword': '当前密码',
        'profile.newPassword': '新密码，至少 8 位',
        'profile.dangerTitle': '危险操作',
        'profile.dangerDesc': '注销账号后，所有数据将被永久删除，无法恢复。',
        'profile.deleteConfirmPwd': '输入密码以确认注销',
        'profile.deleteAccount': '注销账号',
        'profile.avatarHint': '点击头像上传并裁剪（保存到账号，他人可见）',
        'profile.avatarSynced': '头像已保存到服务器',
        'profile.avatarLocalOnly': '服务器同步失败，仅保存在本机',
        'profile.coverSynced': '封面已保存到服务器',
        'profile.coverLocalOnly': '封面同步失败，仅保存在本机',
        'profile.coverEdit': '更换封面',
        'profile.viewCover': '点击查看背景大图',
        'profile.viewAvatar': '点击查看头像原图',
        'messages.title': '消息',
        'messages.subtitle': '和好友私聊、管理你的好友关系',
        'messages.tabChats': '私信',
        'messages.tabFriends': '好友',
        'messages.tabInteract': '互动',
        'messages.noChats': '还没有私信，加好友后就可以聊天了',
        'messages.chatPlaceholder': '输入消息…',
        'messages.searchFriend': '搜索用户名添加好友…',
        'messages.addFriend': '添加',
        'messages.sentRequests': '我发出的请求',
        'messages.newRequests': '新的好友请求',
        'messages.myFriends': '我的好友',
        'messages.noFriends': '还没有好友，搜索添加吧',
        'messages.noInteract': '暂无互动通知',
        'messages.loadFail': '加载失败，请稍后重试',
        'messages.chatBg': '聊天背景',
        'messages.chatBgHint': '仅保存在本机，对方看不到',
        'messages.chatBgUpload': '从相册选择',
        'messages.chatBgReset': '恢复默认',
        'messages.accept': '接受',
        'messages.reject': '拒绝',
        'messages.notifLike': '{name} 赞了你的帖子',
        'messages.notifComment': '{name} 评论了你的帖子',
        'messages.notifFriendReq': '{name} 请求加你为好友',
        'messages.notifFriendAccept': '{name} 接受了你的好友请求',
        'messages.notifDefault': '{name} 与你互动了',
        'auth.login': '登录',
        'auth.register': '注册',
        'auth.forgot': '找回密码',
        'auth.email': '邮箱',
        'auth.password': '密码',
        'auth.username': '用户名',
        'auth.code': '邮箱验证码',
        'auth.getCode': '获取验证码',
        'auth.passwordMin': '密码 (至少8位)',
        'auth.newPasswordMin': '新密码 (至少8位)',
        'auth.noAccount': '还没有账号？',
        'auth.registerNow': '立即注册',
        'auth.forgotLink': '忘记密码？',
        'auth.hasAccount': '已有账号？',
        'auth.goLogin': '去登录',
        'auth.resetPassword': '重置密码',
        'auth.backLogin': '返回登录',
        'map.back': '返回',
        'map.title': '附近组局地图',
        'toast.langChanged': '语言已切换',
        'toast.loggedOut': '已退出登录',
        'toast.loginRequired': '请先登录后再发起组局',
        'messages.anonymous': '有人',
        'messages.user': '用户',
        'messages.handledAccept': '已接受',
        'messages.handledReject': '已拒绝',
        'messages.startChat': '发条消息开始聊天',
        'messages.chatLoadFail': '无法加载聊天',
        'messages.campusLabel': '{name}校区',
        'messages.friendRequestBio': '请求加你为好友',
        'messages.waitPending': '等待对方处理',
        'messages.cancelRequest': '撤回',
        'messages.sendMsg': '发消息',
        'messages.homepage': '主页',
        'messages.removeFriend': '删除好友',
        'messages.notFound': '没有找到「{key}」',
        'messages.searchFail': '搜索失败',
        'messages.confirmRemoveFriend': '确认删除该好友吗？删除后将无法继续私信。',
        'messages.friendRemoved': '已删除好友',
        'messages.friendAdded': '已添加好友',
        'messages.requestRejected': '已拒绝好友请求',
        'messages.requestSent': '好友请求已发送',
        'messages.requestCancelled': '已撤回好友申请',
        'messages.bgSaved': '背景已设置',
        'messages.bgReset': '已恢复默认背景',
        'messages.bgCustomSaved': '自定义背景已设置',
        'messages.bgSaveFail': '保存失败，图片可能过大',
        'messages.imageFail': '图片处理失败',
        'messages.sendFail': '发送失败',
        'messages.pendingSent': '已申请',
        'messages.pendingReceived': '待你处理',
        'messages.addFriend': '加好友',
        'messages.sectionSent': '我发出的请求 ({n})',
        'messages.sectionNew': '新的好友请求 ({n})',
        'messages.sectionFriends': '我的好友 ({n})',
        'messages.chatBgBtn': '聊天背景',
        'messages.close': '关闭',
        'messages.loadOlder': '↑ 上拉加载更早消息',
        'filter.scrollLeft': '向左滑动',
        'filter.scrollRight': '向右滑动',
        'chatBg.default': '默认',
        'chatBg.lavender': '薄紫',
        'chatBg.ocean': '海盐',
        'chatBg.sunset': '晚霞',
        'chatBg.forest': '浅绿',
        'chatBg.night': '夜空',
        'chatBg.paper': '米纸',
    },
    en: {
        'nav.home': 'Home',
        'nav.partner': 'Find Buddies',
        'nav.ai': 'AI Assistant',
        'nav.guide': 'Explore',
        'nav.profile': 'Profile',
        'nav.messages': 'Messages',
        'nav.fullMap': 'Event Map',
        'nav.guideShort': 'Guide',
        'nav.profileShort': 'Me',
        'common.login': 'Log in',
        'common.logout': 'Log out',
        'common.save': 'Save',
        'common.cancel': 'Cancel',
        'common.loading': 'Loading...',
        'common.all': 'All',
        'lang.switch': '中文',
        'lang.label': 'Language',
        'theme.dark': 'Switch to dark mode',
        'theme.light': 'Switch to light mode',
        'brand.home': 'NJUATLAS Home',
        'home.subtitle': 'NJU Atlas · Campus buddy platform',
        'home.btnPartner': 'Find buddies',
        'home.btnGuide': 'Explore nearby',
        'home.feat1Title': 'Find buddies',
        'home.feat1Desc': 'Browse food, sports, study buddies and more — join activities in one tap.',
        'home.feat2Title': 'Explore',
        'home.feat2Desc': 'Discover food, fun, and study spots near campus with filters and AI tips.',
        'home.feat3Title': 'Profile',
        'home.feat3Desc': 'Manage your profile, posts, comments, favorites, and activity history.',
        'home.feat4Title': 'Event map',
        'home.feat4Desc': 'See nearby events on the map, tap markers for details and quick join.',
        'ai.newChat': 'New chat',
        'ai.batchManage': 'Manage',
        'ai.batchDelete': 'Delete',
        'ai.batchCancel': 'Cancel',
        'ai.loadingHistory': 'Loading chats...',
        'ai.welcomeTitle': 'Hi, I\'m NJU Atlas AI',
        'ai.welcomeDesc': 'Ask me about food and fun near Nanjing University~',
        'ai.welcomeHint': 'Try a suggestion below, or type your question',
        'ai.inputPlaceholder': 'Ask anything, e.g. good food near NJU',
        'ai.send': 'Send',
        'partner.searchPlaceholder': 'Search posts: title, place, tags…',
        'partner.searchClear': 'Clear search',
        'partner.nearbyMap': 'Nearby events',
        'partner.fullMap': 'Full map',
        'partner.createGroup': 'Create event',
        'partner.viewMap': 'View map',
        'partner.legend.food': 'Food',
        'partner.legend.sport': 'Sports',
        'partner.legend.game': 'Games',
        'partner.legend.movie': 'Movies',
        'partner.legend.study': 'Study',
        'partner.legend.other': 'Other',
        'cat.all': 'All',
        'cat.food': 'Food buddies',
        'cat.sport': 'Sports buddies',
        'cat.study': 'Study buddies',
        'cat.game': 'Game buddies',
        'cat.movie': 'Movie buddies',
        'cat.travel': 'Travel buddies',
        'cat.music': 'Music buddies',
        'cat.photo': 'Photo buddies',
        'cat.other': 'Other',
        'guide.title': 'Around NJU · Food & Fun',
        'guide.subtitle': 'Discover gems near campus',
        'guide.refresh': 'Refresh',
        'guide.loading': 'Loading recommendations...',
        'guide.cat.food': 'Food',
        'guide.cat.coffee': 'Coffee & drinks',
        'guide.cat.fun': 'Entertainment',
        'guide.cat.fitness': 'Fitness',
        'guide.cat.shop': 'Shopping',
        'guide.cat.park': 'Parks & sights',
        'profile.center': 'Profile',
        'profile.edit': 'Edit profile',
        'profile.defaultBio': 'No bio yet...',
        'profile.verifyEmail': 'Verify email',
        'profile.statPosts': 'Posts',
        'profile.statFriends': 'Friends',
        'profile.statLikes': 'Likes',
        'profile.statComments': 'Comments',
        'profile.statFavorites': 'Saved',
        'profile.tabPosts': 'My posts',
        'profile.tabComments': 'My comments',
        'profile.tabFavorites': 'My favorites',
        'profile.tabActivities': 'My activities',
        'profile.editTitle': 'Edit profile',
        'profile.username': 'Username',
        'profile.bio': 'Bio',
        'profile.tags': 'Interest tags (comma-separated)',
        'profile.campus': 'Campus',
        'profile.campusNone': 'Not set',
        'profile.changePassword': 'Change password (leave blank to skip)',
        'profile.oldPassword': 'Current password',
        'profile.newPassword': 'New password (min. 8 chars)',
        'profile.dangerTitle': 'Danger zone',
        'profile.dangerDesc': 'Deleting your account permanently removes all data.',
        'profile.deleteConfirmPwd': 'Enter password to confirm',
        'profile.deleteAccount': 'Delete account',
        'profile.avatarHint': 'Tap avatar to upload (saved to your account, visible to others)',
        'profile.avatarSynced': 'Avatar saved to server',
        'profile.avatarLocalOnly': 'Saved on this device only — server sync failed',
        'profile.coverSynced': 'Cover saved to server',
        'profile.coverLocalOnly': 'Cover sync failed — saved on this device only',
        'profile.coverEdit': 'Change cover',
        'profile.viewCover': 'View cover image',
        'profile.viewAvatar': 'View avatar',
        'messages.title': 'Messages',
        'messages.subtitle': 'Chat with friends and manage connections',
        'messages.tabChats': 'Chats',
        'messages.tabFriends': 'Friends',
        'messages.tabInteract': 'Activity',
        'messages.noChats': 'No chats yet — add friends to start messaging',
        'messages.chatPlaceholder': 'Type a message…',
        'messages.searchFriend': 'Search username to add friend…',
        'messages.addFriend': 'Add',
        'messages.sentRequests': 'Sent requests',
        'messages.newRequests': 'Friend requests',
        'messages.myFriends': 'My friends',
        'messages.noFriends': 'No friends yet — search to add',
        'messages.noInteract': 'No notifications yet',
        'messages.loadFail': 'Failed to load, try again',
        'messages.chatBg': 'Chat background',
        'messages.chatBgHint': 'Saved on this device only — others cannot see it',
        'messages.chatBgUpload': 'Choose from album',
        'messages.chatBgReset': 'Reset default',
        'messages.accept': 'Accept',
        'messages.reject': 'Decline',
        'messages.notifLike': '{name} liked your post',
        'messages.notifComment': '{name} commented on your post',
        'messages.notifFriendReq': '{name} sent you a friend request',
        'messages.notifFriendAccept': '{name} accepted your friend request',
        'messages.notifDefault': '{name} interacted with you',
        'auth.login': 'Log in',
        'auth.register': 'Sign up',
        'auth.forgot': 'Reset password',
        'auth.email': 'Email',
        'auth.password': 'Password',
        'auth.username': 'Username',
        'auth.code': 'Email code',
        'auth.getCode': 'Get code',
        'auth.passwordMin': 'Password (min. 8 chars)',
        'auth.newPasswordMin': 'New password (min. 8 chars)',
        'auth.noAccount': 'No account yet?',
        'auth.registerNow': 'Sign up',
        'auth.forgotLink': 'Forgot password?',
        'auth.hasAccount': 'Already have an account?',
        'auth.goLogin': 'Log in',
        'auth.resetPassword': 'Reset password',
        'auth.backLogin': 'Back to log in',
        'map.back': 'Back',
        'map.title': 'Nearby event map',
        'toast.langChanged': 'Language updated',
        'toast.loggedOut': 'Logged out',
        'toast.loginRequired': 'Please log in to create an event',
        'messages.anonymous': 'Someone',
        'messages.user': 'User',
        'messages.handledAccept': 'Accepted',
        'messages.handledReject': 'Declined',
        'messages.startChat': 'Send a message to start chatting',
        'messages.chatLoadFail': 'Could not load chat',
        'messages.campusLabel': '{name} campus',
        'messages.friendRequestBio': 'Wants to add you as a friend',
        'messages.waitPending': 'Awaiting response',
        'messages.cancelRequest': 'Cancel',
        'messages.sendMsg': 'Message',
        'messages.homepage': 'Profile',
        'messages.removeFriend': 'Remove',
        'messages.notFound': 'No results for "{key}"',
        'messages.searchFail': 'Search failed',
        'messages.confirmRemoveFriend': 'Remove this friend? You will no longer be able to message them.',
        'messages.friendRemoved': 'Friend removed',
        'messages.friendAdded': 'Friend added',
        'messages.requestRejected': 'Friend request declined',
        'messages.requestSent': 'Friend request sent',
        'messages.requestCancelled': 'Request cancelled',
        'messages.bgSaved': 'Background updated',
        'messages.bgReset': 'Background reset',
        'messages.bgCustomSaved': 'Custom background set',
        'messages.bgSaveFail': 'Save failed — image may be too large',
        'messages.imageFail': 'Image processing failed',
        'messages.sendFail': 'Send failed',
        'messages.pendingSent': 'Pending',
        'messages.pendingReceived': 'Respond',
        'messages.addFriend': 'Add friend',
        'messages.sectionSent': 'Sent requests ({n})',
        'messages.sectionNew': 'Friend requests ({n})',
        'messages.sectionFriends': 'My friends ({n})',
        'messages.chatBgBtn': 'Chat background',
        'messages.close': 'Close',
        'messages.loadOlder': '↑ Scroll up for older messages',
        'filter.scrollLeft': 'Scroll left',
        'filter.scrollRight': 'Scroll right',
        'chatBg.default': 'Default',
        'chatBg.lavender': 'Lavender',
        'chatBg.ocean': 'Ocean',
        'chatBg.sunset': 'Sunset',
        'chatBg.forest': 'Forest',
        'chatBg.night': 'Night',
        'chatBg.paper': 'Paper',
    },
};

const GUIDE_CAT_KEYS = {
    all: 'common.all',
    '美食': 'guide.cat.food',
    '咖啡饮品': 'guide.cat.coffee',
    '休闲娱乐': 'guide.cat.fun',
    '运动健身': 'guide.cat.fitness',
    '购物商圈': 'guide.cat.shop',
    '景点公园': 'guide.cat.park',
};

const CHAT_BG_NAME_KEYS = {
    default: 'chatBg.default',
    lavender: 'chatBg.lavender',
    ocean: 'chatBg.ocean',
    sunset: 'chatBg.sunset',
    forest: 'chatBg.forest',
    night: 'chatBg.night',
    paper: 'chatBg.paper',
};

const PARTNER_CAT_KEYS = {
    all: 'cat.all',
    '饭搭子': 'cat.food',
    '运动搭子': 'cat.sport',
    '学习搭子': 'cat.study',
    '游戏搭子': 'cat.game',
    '电影搭子': 'cat.movie',
    '旅游搭子': 'cat.travel',
    '音乐搭子': 'cat.music',
    '摄影搭子': 'cat.photo',
    '其他': 'cat.other',
};

let currentLocale = DEFAULT_LOCALE;

function normalizeLocale(raw) {
    return raw === 'en' ? 'en' : 'zh';
}

export function getLocale() {
    return currentLocale;
}

export function t(key, params = {}) {
    const table = MESSAGES[currentLocale] || MESSAGES.zh;
    let text = table[key] ?? MESSAGES.zh[key] ?? key;
    Object.entries(params).forEach(([k, v]) => {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? ''));
    });
    return text;
}

export function tPartnerCategory(category) {
    const key = PARTNER_CAT_KEYS[category];
    return key ? t(key) : category;
}

export function tGuideCategory(category) {
    const key = GUIDE_CAT_KEYS[category];
    return key ? t(key) : category;
}

export function tChatBgName(presetId) {
    const key = CHAT_BG_NAME_KEYS[presetId];
    return key ? t(key) : presetId;
}

function applyAttr(root, selector, attr, keyAttr) {
    root.querySelectorAll(selector).forEach((el) => {
        const key = el.getAttribute(keyAttr);
        if (key) el[attr] = t(key);
    });
}

export function applyDocumentI18n(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (key) el.textContent = t(key);
    });
    applyAttr(root, '[data-i18n-placeholder]', 'placeholder', 'data-i18n-placeholder');
    applyAttr(root, '[data-i18n-title]', 'title', 'data-i18n-title');
    applyAttr(root, '[data-i18n-aria]', 'ariaLabel', 'data-i18n-aria');

    root.querySelectorAll('.desktop-nav-item[data-page]').forEach((el) => {
        const page = el.getAttribute('data-page');
        if (page) el.textContent = t(`nav.${page}`);
    });
    root.querySelectorAll('.bottom-tab-bar .tab-item[data-page]').forEach((el) => {
        const page = el.getAttribute('data-page');
        const span = el.querySelector('span');
        if (!page || !span) return;
        if (page === 'guide') span.textContent = t('nav.guideShort');
        else if (page === 'profile') span.textContent = t('nav.profileShort');
        else if (page === 'ai') span.textContent = 'AI';
        else span.textContent = t(`nav.${page}`);
    });

    root.querySelectorAll('#guideFilter [data-guide-cat]').forEach((btn) => {
        const cat = btn.getAttribute('data-guide-cat');
        if (!cat) return;
        const label = tGuideCategory(cat);
        const icon = btn.querySelector('i');
        btn.textContent = '';
        if (icon) btn.appendChild(icon);
        btn.append(`${icon ? ' ' : ''}${label}`);
    });

    document.documentElement.lang = currentLocale === 'en' ? 'en' : 'zh-CN';
    document.title = `nju.atlas · ${t('nav.partner')}`;
}

export function setLocale(locale) {
    const next = normalizeLocale(locale);
    if (next === currentLocale) return false;
    currentLocale = next;
    try {
        localStorage.setItem(LOCALE_KEY, next);
    } catch { /* ignore */ }
    applyDocumentI18n();
    window.dispatchEvent(new CustomEvent('njuatlas:localechange', { detail: { locale: next } }));
    return true;
}

export function initLocale() {
    try {
        currentLocale = normalizeLocale(localStorage.getItem(LOCALE_KEY) || DEFAULT_LOCALE);
    } catch {
        currentLocale = DEFAULT_LOCALE;
    }
    applyDocumentI18n();
}

export function initLocaleToggle() {
    const btn = document.getElementById('localeToggleBtn');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';

    const sync = () => {
        btn.textContent = t('lang.switch');
        btn.title = t('lang.label');
        btn.setAttribute('aria-label', t('lang.label'));
    };
    sync();

    btn.addEventListener('click', () => {
        if (setLocale(currentLocale === 'zh' ? 'en' : 'zh')) {
            sync();
        }
    });

    window.addEventListener('njuatlas:localechange', sync);
}

export function getPageTitleKey(pageId) {
    return `nav.${pageId}`;
}
