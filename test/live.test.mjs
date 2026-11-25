/**
 * 真实接口（live）测试：跟随一木记账 App 版本更新时由 CI 触发。
 *
 * 默认不参与 `npm test`；需要显式设置 YIMU_LIVE=1 才执行：
 *   YIMU_LIVE=1 node --test test/live.test.mjs
 *
 * 覆盖两层：
 *   1. 匿名扫码接口：不需要任何凭据，验证官方信封、二维码与轮询状态；
 *   2. 业务只读工具：需要 YIMU_TOKEN（GitHub Actions secret），只读，不写任何账单。
 *
 * 每个用例都通过 stdio 启动真实的 `src/index.js` 子进程，环境变量按用例隔离，
 * 避免 config.js 在模块加载时固化 token / mock 配置。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const indexPath = fileURLToPath(new URL("../src/index.js", import.meta.url));
const LIVE = process.env.YIMU_LIVE === "1";
const TOKEN = String(process.env.YIMU_TOKEN || "");
const stateDirs = [];

/** 干净的子进程环境：去掉宿主上的 YIMU_*，再挂上本用例需要的值。 */
function isolatedEnv(extra) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("YIMU_")) delete env[key];
  }
  Object.assign(env, extra);
  const stateDir = mkdtempSync(path.join(tmpdir(), "yimu-live-"));
  stateDirs.push(stateDir);
  env.YIMU_STATE_DIR = stateDir;
  return env;
}

async function connect(extra = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [indexPath],
    env: isolatedEnv(extra),
    stderr: "pipe",
  });
  const client = new Client({ name: "yimu-live", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

/** 调用工具并把文本 JSON 解析出来；超时与工具错误都抛出可读信息。 */
async function callJson(client, name, args = {}, timeoutMs = 90_000) {
  let timer;
  try {
    const result = await Promise.race([
      client.callTool({ name, arguments: args }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} 超过 ${timeoutMs}ms 没有返回`)), timeoutMs);
      }),
    ]);
    const text = result.content?.[0]?.text ?? "";
    if (result.isError) throw new Error(`${name} 返回错误：${text.slice(0, 500)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

test.after(() => {
  for (const dir of stateDirs) rmSync(dir, { recursive: true, force: true });
});

test("真实接口：匿名扫码登录仍然可用", { skip: !LIVE, timeout: 120_000 }, async () => {
  const client = await connect();
  try {
    const { tools } = await client.listTools();
    assert.ok(
      tools.some((tool) => tool.name === "login_start"),
      "没有 token 时应注册扫码登录工具",
    );
    const started = await client.callTool({ name: "login_start", arguments: {} });
    assert.notEqual(started.isError, true, started.content?.[0]?.text);
    const text = started.content?.[0]?.text ?? "";
    const session = text.match(/session_id: ([0-9a-zA-Z]+)/);
    assert.ok(session, "login_start 的文本里应包含 session_id");
    const image = started.content?.find((part) => part.type === "image");
    assert.ok(image, "login_start 应返回二维码图片");
    assert.equal(image.mimeType, "image/png");
    assert.ok(image.data.length > 1024, "二维码 PNG 太小");
    assert.match(session[1], /^[0-9a-f]+$/i);

    const polled = await callJson(client, "login_poll", { session_id: session[1] });
    assert.equal(polled.status, "pending", "未扫码时应保持 pending");
  } finally {
    await client.close();
  }
});

test("真实接口：业务只读工具（需要 YIMU_TOKEN）", { skip: !LIVE || !TOKEN, timeout: 180_000 }, async () => {
  const client = await connect({ YIMU_TOKEN: TOKEN });
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 11, "有 token 时只应注册 11 个业务工具");
    assert.ok(!tools.some((tool) => tool.name === "login_start"));

    const overview = await callJson(client, "overview");
    assert.equal(typeof overview.month?.month, "string");
    assert.equal(typeof overview.month?.expense, "number");
    assert.equal(typeof overview.month?.income, "number");
    assert.equal(typeof overview.today?.date, "string");

    const accounts = await callJson(client, "accounts");
    assert.ok(Array.isArray(accounts.funds));
    assert.ok(Array.isArray(accounts.credit));
    assert.ok(Array.isArray(accounts.debt));
    assert.ok(accounts.investments && typeof accounts.investments === "object");

    const bills = await callJson(client, "query_bills", { limit: 5 });
    assert.equal(typeof bills.count, "number");
    assert.equal(bills.limit, 5);
    assert.ok(Array.isArray(bills.bills));
    for (const bill of bills.bills) {
      assert.equal(typeof bill.bill_id, "number");
      assert.match(String(bill.time), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    }

    const stats = await callJson(client, "stats", { by: "category" });
    assert.equal(stats.by, "category");
    assert.ok(Array.isArray(stats.groups));
  } finally {
    await client.close();
  }
});
