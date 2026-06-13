/**
 * 吃喝玩乐冷加载：严格串行，按校区 × 分类逐个预取，避免触发 429。
 * 顺序：鼓楼(6 分类) → 全部(6) → 仙林(6) → 浦口(6) → 苏州(6)
 */
import { getGuideLeaderboard } from './api.js';
import {
    ALL_GUIDE_CATEGORIES,
    entryCacheKey,
    persistLeaderboardToStorage,
    readLeaderboardRow,
} from './guide-warm-cache.js';

/** 预取校区顺序（与 UI Tab 顺序无关） */
const PREFETCH_CAMPUS_ORDER = ['鼓楼', 'all', '仙林', '浦口', '苏州'];
const PREFETCH_GAP_MS = 280;
const PREFETCH_429_BASE_MS = 2000;
const PREFETCH_MAX_ATTEMPTS = 4;

let _fullPrefetchPromise = null;

export function listGuidePrefetchTasks() {
    const tasks = [];
    for (const campus of PREFETCH_CAMPUS_ORDER) {
        for (const category of ALL_GUIDE_CATEGORIES) {
            tasks.push({ campus, category, key: entryCacheKey(campus, category) });
        }
    }
    return tasks;
}

/** 仅「全部校区」× 各分类（6 项） */
export function listGuideAllCampusTasks() {
    return listGuidePrefetchTasks().filter((task) => task.campus === 'all');
}

function _isRateLimitError(err) {
    const msg = String(err?.message || '');
    return msg.includes('过于频繁') || msg.includes('429');
}

async function _fetchOnePrefetchTask(task) {
    if (readLeaderboardRow(task.key)) return;

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

async function _runPrefetchTasks(tasks) {
    for (const task of tasks) {
        await _fetchOnePrefetchTask(task);
        if (PREFETCH_GAP_MS > 0) {
            await new Promise((r) => setTimeout(r, PREFETCH_GAP_MS));
        }
    }
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

/** 全量串行预取（共 30 项，已有缓存则跳过） */
export function prefetchAllGuideLeaderboards() {
    if (_fullPrefetchPromise) return _fullPrefetchPromise;

    _fullPrefetchPromise = _runPrefetchTasks(listGuidePrefetchTasks()).finally(() => {
        _fullPrefetchPromise = null;
    });

    return _fullPrefetchPromise;
}

/** 兼容旧调用：并入全量串行队列 */
export function prefetchGuideAllCampusLeaderboards() {
    return prefetchAllGuideLeaderboards();
}

export function isGuidePrefetchComplete() {
    return listGuidePrefetchTasks().every((task) => readLeaderboardRow(task.key));
}

export function isGuideAllCampusPrefetchComplete() {
    return listGuideAllCampusTasks().every((task) => readLeaderboardRow(task.key));
}
