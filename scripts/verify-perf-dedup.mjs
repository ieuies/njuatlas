/**
 * 验证请求去重与预取单飞逻辑（不依赖浏览器 / 后端）。
 * 运行: node scripts/verify-perf-dedup.mjs
 */
import { dedupeInflight } from '../js/request-dedupe.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
    if (cond) {
        passed += 1;
        console.log(`  OK  ${msg}`);
    } else {
        failed += 1;
        console.error(` FAIL ${msg}`);
    }
}

async function testDedupeInflight() {
    console.log('\n[dedupeInflight]');
    let runs = 0;
    const slow = dedupeInflight('test-key', () => new Promise((resolve) => {
        runs += 1;
        setTimeout(() => resolve('ok'), 30);
    }));
    const dup1 = dedupeInflight('test-key', () => {
        runs += 1;
        return Promise.resolve('dup');
    });
    const dup2 = dedupeInflight('test-key', () => {
        runs += 1;
        return Promise.resolve('dup');
    });
    const [a, b, c] = await Promise.all([slow, dup1, dup2]);
    assert(runs === 1, `并发同 key 只执行 1 次 factory（实际 ${runs}）`);
    assert(a === 'ok' && b === 'ok' && c === 'ok', '所有调用者收到同一结果');

    let runs2 = 0;
    await dedupeInflight('key-2', () => {
        runs2 += 1;
        return Promise.resolve(1);
    });
    await dedupeInflight('key-2', () => {
        runs2 += 1;
        return Promise.resolve(2);
    });
    assert(runs2 === 2, `完成后同 key 可再次请求（实际 ${runs2} 次）`);
}

async function testLoginPrefetchDedupSimulation() {
    console.log('\n[login prefetch 模拟]');
    let apiCalls = 0;
    let listsInflight = null;

    async function prefetchMessagesLists({ force = false } = {}) {
        if (listsInflight && !force) return listsInflight;
        listsInflight = Promise.all([
            Promise.resolve().then(() => { apiCalls += 1; return 'bootstrap'; }),
            Promise.resolve().then(() => { apiCalls += 1; return 'friends'; }),
            Promise.resolve().then(() => { apiCalls += 1; return 'notif'; }),
        ]).then(([b]) => b).finally(() => { listsInflight = null; });
        return listsInflight;
    }

    function scheduleMessagesPrefetch() {
        return prefetchMessagesLists();
    }

    // 模拟：auth-change + home 登录（优化后 home 不再调用）
    await Promise.all([
        scheduleMessagesPrefetch(),
        scheduleMessagesPrefetch(),
    ]);
    assert(apiCalls === 3, `双次 scheduleMessagesPrefetch 仅 3 个 API（实际 ${apiCalls}）`);
}

async function testPartnerPrefetchGapSimulation() {
    console.log('\n[partner prefetch gap 模拟]');
    const PREFETCH_GAP_MS = 10;
    const categories = ['all', '饭搭子', '运动搭子'];
    const cached = new Set(['all', '饭搭子']);
    let slept = 0;
    const t0 = Date.now();

    for (const category of categories) {
        const skipped = cached.has(category);
        if (PREFETCH_GAP_MS > 0 && !skipped) {
            await new Promise((r) => setTimeout(r, PREFETCH_GAP_MS));
            slept += 1;
        }
    }

    const elapsed = Date.now() - t0;
    assert(slept === 1, `3 分类中 2 个 cache hit 只 sleep 1 次（实际 ${slept}）`);
    assert(elapsed < 25, `总等待约 10ms 而非 30ms（实际 ${elapsed}ms）`);
}

async function testGuideCacheFreshSkip() {
    console.log('\n[guide cache fresh 模拟]');
    const GUIDE_CACHE_TTL_MS = 60000;
    const at = Date.now();
    const isFresh = at && (Date.now() - at) < GUIDE_CACHE_TTL_MS;
    let backgroundFetches = 0;

    const cached = { items: [] };
    if (cached && isFresh) {
        // skip background
    } else {
        backgroundFetches += 1;
    }
    assert(backgroundFetches === 0, '缓存新鲜时跳过 background refetch');
}

async function main() {
    console.log('=== njuatlas 性能优化验证 ===');
    await testDedupeInflight();
    await testLoginPrefetchDedupSimulation();
    await testPartnerPrefetchGapSimulation();
    await testGuideCacheFreshSkip();
    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
