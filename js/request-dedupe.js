/** 同 key 的并发 GET 合并为单次 in-flight 请求 */
const _inflight = new Map();

export function dedupeInflight(key, run) {
    const existing = _inflight.get(key);
    if (existing) return existing;
    const promise = Promise.resolve().then(run).finally(() => {
        if (_inflight.get(key) === promise) _inflight.delete(key);
    });
    _inflight.set(key, promise);
    return promise;
}
