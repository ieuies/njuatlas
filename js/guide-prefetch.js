/**
 * 吃喝玩乐冷加载：分阶段串行预取，避免触发 429。
 * Stage 1：鼓楼 × 6 分类（默认首屏）
 * Stage 2：all × 6 分类
 * Stage 3：仙林 / 浦口 / 苏州 × 6（空闲后台）
 */
import { getGuideLeaderboard } from './api.js';
import {
    ALL_GUIDE_CATEGORIES,
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

let _pipelinePromise = null;
let _fullPrefetchPromise = null;
let _stage3IdleScheduled = false;

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

function _isRateLimitError(err) {
    const msg = String(err?.message || '');
    return msg.includes('过于频繁') || msg.includes('429');
}

async function _fetchOnePrefetchTask(task, { force = false } = {}) {
    if (!force && readLeaderboardRow(task.key)) return;

    for (let attempt = 0; attempt < PREFETCH_MAX_ATTEMPTS; attempt += 1) {
        try {
            const data = await getGuideLeaderboard(task.campus, task.category);
            persistLeaderboardToStorage(task.key, data);
            return;
        } catch (err) {
            if (_isRateLimitError(err) && attempt < PREFETCH_MAX_ATTEMPTS - 1) {
                const delay = PREFETCH_429_BASE_MS * (2 ** attempt);
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            return;
        }
    }
}

export async function prefetchGuideLeaderboardsStage(tasks, { force = false } = {}) {
    for (const task of tasks) {
        await _fetchOnePrefetchTask(task, { force });
        if (PREFETCH_GAP_MS > 0) {
            await new Promise((r) => setTimeout(r, PREFETCH_GAP_MS));
        }
    }
}

function _scheduleStage3Prefetch(options = {}) {
    if (_stage3IdleScheduled) return;
    _stage3IdleScheduled = true;

    const run = () => {
        prefetchGuideLeaderboardsStage(listGuideStage3Tasks(), options).catch(() => {});
    };

    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run, { timeout: 3000 });
    } else {
        setTimeout(run, 500);
    }
}

/** Stage 1：鼓楼全分类（供 switchPage / loadLeaderboard 补拉） */
export function prefetchGuideEntryLeaderboards(options = {}) {
    return prefetchGuideLeaderboardsStage(listGuideStage1Tasks(), options);
}

/**
 * 分阶段预取：Stage 1+2 立即串行，Stage 3 空闲后台。
 */
export function scheduleGuidePrefetch(options = {}) {
    if (_pipelinePromise) return _pipelinePromise;

    _pipelinePromise = (async () => {
        await prefetchGuideLeaderboardsStage(listGuideStage1Tasks(), options);
        await prefetchGuideLeaderboardsStage(listGuideStage2Tasks(), options);
        _scheduleStage3Prefetch(options);
    })()
        .catch(() => {})
        .finally(() => {
            _pipelinePromise = null;
        });

    return _pipelinePromise;
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
        await prefetchGuideLeaderboardsStage(listGuideStage1Tasks(), options);
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
