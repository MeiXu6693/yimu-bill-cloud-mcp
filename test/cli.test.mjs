import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { VERSION } from "../src/version.js";

const run = promisify(execFile);
const indexPath = fileURLToPath(new URL("../src/index.js", import.meta.url));
const stateDir = mkdtempSync(path.join(tmpdir(), "yimu-cli-"));

const BUSINESS_TOOLS = [
  "overview",
  "query_bills",
  "stats",
  "accounts",
  "bill_add",
  "bills_add",
  "bill_update",
  "bill_delete",
  "transfer_add",
  "report",
  "admin",
];

/** 干净的子进程环境：不带任何一木凭据，验证清单命令不需要 token。 */
function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) {
    if (key.startsWith("YIMU_") && !(key in extra)) delete env[key];
  }
  env.YIMU_STATE_DIR = stateDir;
  return env;
}

test.after(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

test("--version 打印包版本并退出 0", async () => {
  const { stdout } = await run(process.execPath, [indexPath, "--version"], { env: cleanEnv() });
  assert.equal(stdout.trim(), `yimu-bill-cloud-mcp ${VERSION}`);
});

test("--help 打印用法与环境变量并退出 0", async () => {
  const { stdout } = await run(process.execPath, [indexPath, "--help"], { env: cleanEnv() });
  assert.match(stdout, /用法: yimu-bill-cloud-mcp/);
  assert.match(stdout, /YIMU_TOKEN/);
  assert.match(stdout, /--list-tools/);
});

test("未知参数退出 2 并提示用法", async () => {
  await assert.rejects(
    run(process.execPath, [indexPath, "--bogus"], { env: cleanEnv() }),
    (error) => error.code === 2 && /未知参数: --bogus/.test(error.stderr),
  );
});

test("--list-tools 无 token 列出 11 业务 + 3 登录工具", async () => {
  const { stdout } = await run(process.execPath, [indexPath, "--list-tools"], { env: cleanEnv() });
  const payload = JSON.parse(stdout);
  assert.equal(payload.name, "yimu-bill-cloud-mcp");
  assert.equal(payload.version, VERSION);
  assert.equal(payload.tools.length, 14);
  assert.deepEqual(payload.tools.map((tool) => tool.name), [
    ...BUSINESS_TOOLS,
    "login_start",
    "login_poll",
    "logout",
  ]);
  for (const tool of payload.tools) {
    assert.equal(typeof tool.description, "string");
    assert.equal(tool.inputSchema.type, "object");
  }
});

test("--list-tools 有 YIMU_TOKEN 时只列 11 个业务工具", async () => {
  const { stdout } = await run(process.execPath, [indexPath, "--list-tools"], {
    env: cleanEnv({ YIMU_TOKEN: "fake-token" }),
  });
  const payload = JSON.parse(stdout);
  assert.equal(payload.tools.length, 11);
  assert.deepEqual(payload.tools.map((tool) => tool.name), BUSINESS_TOOLS);
});
