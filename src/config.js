// 运行配置：token 来自网页端 JWT；userId 可显式给，也可从 JWT.aud 推断。
// YIMU_MOCK_BASE 仅供测试把官方域名重写到本地 mock，生产不要设置。
function jwtAudience(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1] || "", "base64url").toString("utf8"));
    return payload.aud || payload.userId || "";
  } catch {
    return "";
  }
}

export const CONFIG = {
  token: String(process.env.YIMU_TOKEN || ""),
  userId: String(process.env.YIMU_USER_ID || jwtAudience(process.env.YIMU_TOKEN || "")),
  timeoutMs: Number(process.env.YIMU_TIMEOUT_MS || 30000),
  mockBase: String(process.env.YIMU_MOCK_BASE || ""),
  cacheTtlMs: Number(process.env.YIMU_CACHE_TTL_MS || 5000),
  taxonomyTtlMs: Number(process.env.YIMU_TAXONOMY_TTL_MS || 600000),
};

export function assertConfig() {
  if (!CONFIG.token) throw new Error("缺少 YIMU_TOKEN（网页版 JWT，放 MCP 配置的 env）");
  if (!CONFIG.userId) throw new Error("缺少 YIMU_USER_ID（或 token 里没有 aud）");
}
