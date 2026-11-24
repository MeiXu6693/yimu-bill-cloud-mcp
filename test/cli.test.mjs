import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const indexPath = fileURLToPath(new URL("../src/index.js", import.meta.url));

/** 干净的子进程环境：不带任何一木凭据，验证清单命令不需要 token。 */
function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("YIMU_")) delete env[key];
  }
  return env;
}

test("--version 打印包版本并退出 0", async () => {
  const { stdout } = await run(process.execPath, [indexPath, "--version"], { env: cleanEnv() });
  assert.match(stdout.trim(), /^yimu-bill-cloud-mcp 0\.1\.2$/);
});

test("--list-tools 无 token 也能列出 11 个工具", async () => {
  const { stdout } = await run(process.execPath, [indexPath, "--list-tools"], { env: cleanEnv() });
  const payload = JSON.parse(stdout);
  assert.equal(payload.name, "yimu-bill-cloud-mcp");
  assert.equal(payload.version, "0.1.2");
  assert.equal(payload.tools.length, 11);
  assert.deepEqual(
    payload.tools.map((tool) => tool.name),
    [
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
    ],
  );
  for (const tool of payload.tools) {
    assert.equal(typeof tool.description, "string");
    assert.equal(tool.inputSchema.type, "object");
  }
});
