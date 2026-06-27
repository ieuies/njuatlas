/**
 * 吃喝玩乐预取：首页不自动拉取；Intent 仅默认项；进 guide 页 idle 后台补全。
 * Stage 1：鼓楼 × 6 分类（bundle 一次请求）
 * Stage 2：all × 6 分类
 * Stage 3：仙林 / 浦口 / 苏州 × 6（空闲后台）
 */
import { getGuideLeaderboard, getGuideLeaderboardBundle } from './api.js';
import {
    ALL_GUIDE_CATEGORIES,
    GUIDE_ENTRY_CAMPUS,
    GUIDE_ENTRY_CATEGORY,
    entryCacheKey,
    persistLeaderboardToStorage,
    readLeaderboardRow,
} from './guide-warm-cache.js';

/** 预取校区顺序（全量列表，与 UI Tab 顺序无关） */
const PREFETCH_CAMPUS_ORDER = ['鼓楼', 'all', '仙林', '浦口', '苏州'];
const STAGE1_CAMPUS = '鼓楼';
const STAGE2_CAMPUS = 'all';
const STAGE3_CAMPUSES = ['仙林', '浦口', '苏州'];
const PREFETCH_GAP_MS = 280;
const PREFETCH_429_BASE_MS = 2000;
const PREFETCH_MAX_ATTEMPTS = 4;
/** 429 后暂停一切 guide 预取，避免雪崩 */
const PREFETCH_RATE_LIMIT_PAUSE_MS = 30_000;

let _pipelinePromise = null;
let _fullPrefetchPromise = null;
let _stage3IdleScheduled = false;
let _prefetchPausedUntil = 0;

function _tasksForCampus(campus) {
    return ALL_GUIDE_CATEGORIES.map((category) => ({
        campus,
        category,
        key: entryCacheKey(campus, category),
    }));
}

export function listGuidePrefetchTasks() {
    const tasks = [];
    for (const campus of PREFETCH_CAMPUS_ORDER) {
        tasks.push(..._tasksForCampus(campus));
    }
    return tasks;
}

export function listGuideStage1Tasks() {
    return _tasksForCampus(STAGE1_CAMPUS);
}

export function listGuideStage2Tasks() {
    return _tasksForCampus(STAGE2_CAMPUS);
}

export function listGuideStage3Tasks() {
    const tasks = [];
    for (const campus of STAGE3_CAMPUSES) {
        tasks.push(..._tasksForCampus(campus));
    }
    return tasks;
}

/** 仅「全部校区」× 各分类（6 项） */
export function listGuideAllCampusTasks() {
    return listGuideStage2Tasks();
}

export function isGuidePrefetchPaused() {
    return Date.now() < _prefetchPausedUntil;
}

function _pausePrefetchOnRateLimit() {
    _prefetchPausedUntil = Date.now() + PREFETCH_RATE_LIMIT_PAUSE_MS;
}

function _isRateLimitError(err) {
    const msg = String(err?.message || '');
    return msg.includes('过于频繁') || msg.includes('429');
}

async function _fetchOnePrefetchTask(task, { force = false } = {}) {
    if (isGuidePrefetchPaused()) return;
    if (!force && readLeaderboardRow(task.key)) return;

    for (let attempt = 0; attempt < PREFETCH_MAX_ATTEMPTS; attempt += 1) {
        if (isGuidePrefetchPaused()) return;
        try {
            const data = await getGuideLeaderboard(task.campus, task.category);
            persistLeaderboardToStorage(task.key, data);
            return;
        } catch (err) {
            if (_isRateLimitError(err)) {
                _pausePrefetchOnRateLimit();
                if (attempt < PREFETCH_MAX_ATTEMPTS - 1) {
                    const delay = PREFETCH_429_BASE_MS * (2 ** attempt);
                    await new Promise((r) => setTimeout(r, delay));
                    continue;
                }
            }
            return;
        }
    }
}

export async function prefetchGuideLeaderboardsStage(tasks, { force = false } = {}) {
    if (isGuidePrefetchPaused()) return;
    for (const task of tasks) {
        if (isGuidePrefetchPaused()) break;
        await _fetchOnePrefetchTask(task, { force });
        if (PREFETCH_GAP_MS > 0) {
            await new Promise((r) => setTimeout(r, PREFETCH_GAP_MS));
        }
    }
}

/** 默认首屏：鼓楼 × 美食，1 次请求（Tab Intent / 进页补拉） */
export function prefetchGuideEntryOnly(options = {}) {
    if (isGuidePrefetchPaused()) return Promise.resolve();
    const task = {
        campus: GUIDE_ENTRY_CAMPUS,
        category: GUIDE_ENTRY_CATEGORY,
        key: entryCacheKey(GUIDE_ENTRY_CAMPUS, GUIDE_ENTRY_CATEGORY),
    };
    if (!options.force && readLeaderboardRow(task.key)) return Promise.resolve();
    return _fetchOnePrefetchTask(task, options);
}

/** 指定校区+分类，1 次请求（切换 Tab 时补拉） */
export function prefetchGuideLeaderboard(campus, category, options = {}) {
    if (isGuidePrefetchPaused()) return Promise.resolve();
    const task = {
        campus,
        category,
        key: entryCacheKey(campus, category),
    };
    if (!options.force && readLeaderboardRow(task.key)) return Promise.resolve();
    return _fetchOnePrefetchTask(task, options);
}

async function prefetchGuideStage1Bundle({ force = false } = {}) {
    if (isGuidePrefetchPaused()) return;
    const tasks = listGuideStage1Tasks();
    const missing = tasks.filter((task) => force || !readLeaderboardRow(task.key));
    if (!missing.length) return;

    const categories = missing.map((t) => t.category);
    try {
        const payload = await getGuideLeaderboardBundle(STAGE1_CAMPUS, categories);
        for (const cat of categories) {
            const items = payload?.boards?.[cat];
            if (!items) continue;
            persistLeaderboardToStorage(entryCacheKey(STAGE1_CAMPUS, cat), {
                campus: STAGE1_CAMPUS,
                category: cat,
                items,
            });
        }
    } catch (err) {
        if (_isRateLimitError(err)) _pausePrefetchOnRateLimit();
        await prefetchGuideLeaderboardsStage(missing, { force });
    }
}

function _scheduleStage3Prefetch(options = {}) {
    if (_stage3IdleScheduled || isGuidePrefetchPaused()) return;
    _stage3IdleScheduled = true;

    const run = () => {
        if (isGuidePrefetchPaused()) return;
        prefetchGuideLeaderboardsStage(listGuideStage3Tasks(), options).catch(() => {});
    };

    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run, { timeout: 4000 });
    } else {
        setTimeout(run, 800);
    }
}

/** Stage 1：鼓楼全分类（bundle 优先） */
export function prefetchGuideEntryLeaderboards(options = {}) {
    return prefetchGuideStage1Bundle(options);
}

/**
 * 仅在 guide 页 idle 触发：Stage1 bundle → Stage2 串行 → Stage3 后台。
 * 不在首页 / 登录回调中调用。
 */
export function scheduleGuideBackgroundPrefetch(options = {}) {
    if (isGuidePrefetchPaused()) return Promise.resolve();
    if (_pipelinePromise) return _pipelinePromise;

    _pipelinePromise = (async () => {
        await prefetchGuideStage1Bundle(options);
        if (isGuidePrefetchPaused()) return;
        await prefetchGuideLeaderboardsStage(listGuideStage2Tasks(), options);
        _scheduleStage3Prefetch(options);
    })()
        .catch(() => {})
        .finally(() => {
            _pipelinePromise = null;
        });

    return _pipelinePromise;
}

/** @deprecated 使用 scheduleGuideBackgroundPrefetch；保留别名供 guide 页调用 */
export function scheduleGuidePrefetch(options = {}) {
    return scheduleGuideBackgroundPrefetch(options);
}

/** 将 sessionStorage 中已预取的榜单灌入 guide 页内存缓存 */
export function hydrateAllLeaderboardsFromStorage(target, timestamps = {}) {
    for (const { key } of listGuidePrefetchTasks()) {
        const row = readLeaderboardRow(key);
        if (!row?.data) continue;
        target[key] = row.data;
        timestamps[key] = row.at;
    }
}

/** 全量串行预取（共 30 项，含 Stage 3，兼容旧 await 调用） */
export function prefetchAllGuideLeaderboards(options = {}) {
    if (_fullPrefetchPromise) return _fullPrefetchPromise;

    _fullPrefetchPromise = (async () => {
        await prefetchGuideStage1Bundle(options);
        await prefetchGuideLeaderboardsStage(listGuideStage2Tasks(), options);
        await prefetchGuideLeaderboardsStage(listGuideStage3Tasks(), options);
    })()
        .catch(() => {})
        .finally(() => {
            _fullPrefetchPromise = null;
        });

    return _fullPrefetchPromise;
}

/** 兼容旧调用 */
export function prefetchGuideAllCampusLeaderboards() {
    return prefetchAllGuideLeaderboards();
}

export function isGuidePrefetchComplete() {
    return listGuidePrefetchTasks().every((task) => readLeaderboardRow(task.key));
}

export function isGuideStage1PrefetchComplete() {
    return listGuideStage1Tasks().every((task) => readLeaderboardRow(task.key));
}

export function isGuideAllCampusPrefetchComplete() {
    return listGuideAllCampusTasks().every((task) => readLeaderboardRow(task.key));
}
