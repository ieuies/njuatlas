/**
 * 吃喝玩乐全量冷加载：进站后后台拉取全部校区 × 分类排行榜。
 * 含四校区 + 「全部」（campus=all，返回 sections 结构）。
 */
import { getGuideLeaderboard } from './api.js';
import {
    ALL_GUIDE_CAMPUSES,
    ALL_GUIDE_CATEGORIES,
    GUIDE_ENTRY_CAMPUS,
    GUIDE_ENTRY_CATEGORY,
    entryCacheKey,
    persistLeaderboardToStorage,
    readLeaderboardRow,
} from './guide-warm-cache.js';

const PREFETCH_CONCURRENCY = 3;
const PREFETCH_GAP_MS = 60;

let _fullPrefetchPromise = null;

export function listGuidePrefetchTasks() {
    const tasks = [];
    for (const campus of ALL_GUIDE_CAMPUSES) {
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

function _sortSingleCampusTasks(tasks) {
    const entryKey = entryCacheKey(GUIDE_ENTRY_CAMPUS, GUIDE_ENTRY_CATEGORY);
    return [...tasks].sort((a, b) => {
        const score = (task) => {
            if (task.key === entryKey) return 0;
            if (task.campus === GUIDE_ENTRY_CAMPUS) return 1;
            return 2;
        };
        const diff = score(a) - score(b);
        return diff !== 0 ? diff : a.key.localeCompare(b.key, 'zh-CN');
    });
}

async function _runPrefetchTasks(tasks) {
    if (!tasks.length) return;
    let cursor = 0;

    async function worker() {
        while (cursor < tasks.length) {
            const task = tasks[cursor];
            cursor += 1;
            if (readLeaderboardRow(task.key)) continue;
            try {
                const data = await getGuideLeaderboard(task.campus, task.category);
                persistLeaderboardToStorage(task.key, data);
            } catch {
                /* 单项失败不影响其余预取 */
            }
            if (PREFETCH_GAP_MS > 0) {
                await new Promise((r) => setTimeout(r, PREFETCH_GAP_MS));
            }
        }
    }

    await Promise.all(
        Array.from({ length: PREFETCH_CONCURRENCY }, () => worker()),
    );
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

/** 全量预取：首屏 → 全部校区×分类 → 四校区其余组合（共 30 项） */
export function prefetchAllGuideLeaderboards() {
    if (_fullPrefetchPromise) return _fullPrefetchPromise;

    _fullPrefetchPromise = (async () => {
        const entryKey = entryCacheKey(GUIDE_ENTRY_CAMPUS, GUIDE_ENTRY_CATEGORY);
        const entryTask = listGuidePrefetchTasks().find((t) => t.key === entryKey);
        const allCampusTasks = listGuideAllCampusTasks();
        const singleCampusTasks = listGuidePrefetchTasks().filter(
            (t) => t.campus !== 'all' && t.key !== entryKey,
        );

        if (entryTask) await _runPrefetchTasks([entryTask]);
        await _runPrefetchTasks(allCampusTasks);
        await _runPrefetchTasks(_sortSingleCampusTasks(singleCampusTasks));
    })().finally(() => {
        _fullPrefetchPromise = null;
    });

    return _fullPrefetchPromise;
}

/** 仅补拉「全部校区」榜单（6 分类） */
export function prefetchGuideAllCampusLeaderboards() {
    return _runPrefetchTasks(listGuideAllCampusTasks().filter((t) => !readLeaderboardRow(t.key)));
}

export function isGuidePrefetchComplete() {
    return listGuidePrefetchTasks().every((task) => readLeaderboardRow(task.key));
}

export function isGuideAllCampusPrefetchComplete() {
    return listGuideAllCampusTasks().every((task) => readLeaderboardRow(task.key));
}
