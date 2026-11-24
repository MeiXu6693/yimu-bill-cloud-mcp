// 全量快照缓存：读工具/校验/更新共用；写后失效并轮询确认。
import { CONFIG } from "./config.js";
import { getSnapshot } from "./client.js";

let state = { at: 0, data: null, loading: null };

export async function snapshot({ force = false } = {}) {
  if (!force && state.data && Date.now() - state.at < CONFIG.cacheTtlMs) return state.data;
  if (state.loading) return state.loading;
  state.loading = (async () => {
    const data = await getSnapshot();
    state.data = data;
    state.at = Date.now();
    return data;
  })().finally(() => {
    state.loading = null;
  });
  return state.loading;
}

export function invalidate() {
  state.at = 0;
}

export async function waitFor(predicate, { timeoutMs = 8000, intervalMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snap = await snapshot({ force: true });
    if (predicate(snap)) return snap;
    if (Date.now() >= deadline) throw new Error("云端写入后回读超时（可能是网页端数据延迟）");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
