// 独立 MCP 的登录态存储。插件模式不会用到（插件始终通过 YIMU_TOKEN 注入）。
//
// 只保存 token/userId，不保存密码；目录 0700、文件 0600，原子写入。
// YIMU_STATE_DIR 仅用于测试/容器隔离，不是面向用户的配置项。
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const STATE_DIR =
  process.env.YIMU_STATE_DIR ||
  path.join(
    process.env.XDG_STATE_HOME || path.join(homedir(), ".local", "state"),
    "yimu-bill-cloud-mcp",
  );

/** 登录态文件路径（测试用来断言权限/内容）。 */
export const AUTH_STORE_PATH = path.join(STATE_DIR, "auth.json");

/**
 * 读取保存的登录态；不存在、损坏或没有 token 时返回 null。
 * @returns {{token: string, userId: string} | null}
 */
export function loadStoredAuth() {
  try {
    const parsed = JSON.parse(readFileSync(AUTH_STORE_PATH, "utf8"));
    if (!parsed || typeof parsed.token !== "string" || parsed.token === "") return null;
    return {
      token: parsed.token,
      userId: typeof parsed.userId === "string" ? parsed.userId : "",
    };
  } catch {
    return null;
  }
}

/**
 * 保存登录态；失败抛错，由调用方决定是否提示。
 * @param {string} token
 * @param {string} userId
 */
export function saveStoredAuth(token, userId) {
  mkdirSync(path.dirname(AUTH_STORE_PATH), { recursive: true, mode: 0o700 });
  const temp = `${AUTH_STORE_PATH}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ token, userId: String(userId ?? "") }), { mode: 0o600 });
  renameSync(temp, AUTH_STORE_PATH);
  chmodSync(AUTH_STORE_PATH, 0o600);
}

/** 删除登录态；不存在时静默。 */
export function clearStoredAuth() {
  rmSync(AUTH_STORE_PATH, { force: true });
}
