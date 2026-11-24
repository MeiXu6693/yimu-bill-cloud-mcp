// 运行配置：优先 YIMU_TOKEN；没有时加载独立 MCP 自己保存的登录态。
// 插件模式始终注入 YIMU_TOKEN，因此不会读取/写入这里的 auth store。
import { loadStoredAuth } from "./auth-store.js";

function jwtAudience(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1] || "", "base64url").toString("utf8"));
    return payload.aud || payload.userId || "";
  } catch {
    return "";
  }
}

const envToken = String(process.env.YIMU_TOKEN || "");
const stored = envToken ? null : loadStoredAuth();
const token = envToken || stored?.token || "";

/** true = 由 MCP 自己管理登录（无 YIMU_TOKEN），需要注册登录工具。 */
export const AUTH_MANAGED = envToken === "";

export const CONFIG = {
  token,
  userId: String(process.env.YIMU_USER_ID || stored?.userId || jwtAudience(token)),
  timeoutMs: Number(process.env.YIMU_TIMEOUT_MS || 30000),
  mockBase: String(process.env.YIMU_MOCK_BASE || ""),
  cacheTtlMs: Number(process.env.YIMU_CACHE_TTL_MS || 5000),
  taxonomyTtlMs: Number(process.env.YIMU_TAXONOMY_TTL_MS || 600000),
};
