import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMock } from "./mock-server.mjs";

let mock;
let server;
let client;
let call;
let stateDir;
let authStorePath;
let loadStoredAuth;

function textOf(result) {
  return result.content.find((item) => item.type === "text").text;
}

test.before(async () => {
  mock = await createMock();
  stateDir = await mkdtemp(path.join(tmpdir(), "yimu-mcp-login-"));
  Object.assign(process.env, {
    YIMU_STATE_DIR: stateDir,
    YIMU_MOCK_BASE: mock.base,
    YIMU_CACHE_TTL_MS: "0",
    YIMU_TAXONOMY_TTL_MS: "0",
    YIMU_RETRY_DELAY_MS: "1",
  });
  delete process.env.YIMU_TOKEN;
  delete process.env.YIMU_USER_ID;

  const authStore = await import("../src/auth-store.js");
  authStorePath = authStore.AUTH_STORE_PATH;
  loadStoredAuth = authStore.loadStoredAuth;
  const { createServer } = await import("../src/server.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  server = createServer();
  await server.connect(serverTransport);
  client = new Client({ name: "test-login", version: "0.0.0" });
  await client.connect(clientTransport);
  call = (name, args = {}) => client.callTool({ name, arguments: args });
});

test.after(async () => {
  if (client) await client.close();
  if (server) await server.close();
  if (mock) await mock.close();
  if (stateDir) await rm(stateDir, { recursive: true, force: true });
});

test("无 token 启动：注册 14 个工具（11 业务 + 3 登录）", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  assert.equal(names.length, 14);
  assert.deepEqual(names.slice(-3), ["login_start", "login_poll", "logout"]);
});

test("login_start：返回 session_id、终端二维码与 PNG", async () => {
  const result = await call("login_start");
  assert.equal(result.isError, undefined);
  const text = textOf(result);
  assert.match(text, /session_id: scan-session-1/);
  assert.match(text, /login_poll/);
  assert.match(text, /[█▀▄]/);
  const image = result.content.find((item) => item.type === "image");
  assert.ok(image, "缺少 PNG 二维码");
  assert.equal(image.mimeType, "image/png");
  assert.ok(image.data.length > 100);
});

test("login_poll：pending → ok，自动保存登录态且不泄露 JWT", async () => {
  const pending = await call("login_poll", { session_id: "scan-session-1" });
  assert.deepEqual(JSON.parse(textOf(pending)), { status: "pending" });

  const ok = await call("login_poll", { session_id: "scan-session-1" });
  const payload = JSON.parse(textOf(ok));
  assert.deepEqual(payload, {
    status: "ok",
    user_id: "1469378",
    user_name: "测试用户",
    persisted: true,
  });
  assert.ok(!JSON.stringify(ok).includes("jwt-test-token"), "工具输出不应包含 JWT");

  const saved = JSON.parse(await readFile(authStorePath, "utf8"));
  assert.equal(saved.token, "jwt-test-token");
  assert.equal(saved.userId, "1469378");
  assert.equal((await stat(authStorePath)).mode & 0o777, 0o600);
  assert.equal(loadStoredAuth()?.token, "jwt-test-token");

  const status = JSON.parse(
    textOf(await call("admin", { domain: "system", action: "token_status" })),
  );
  assert.equal(status.logged_in, true);
  assert.equal(status.user_id, "1469378");
});

test("logout：删除本机登录态并回到未登录", async () => {
  await call("logout");
  await assert.rejects(readFile(authStorePath, "utf8"), /ENOENT/);
  const status = JSON.parse(
    textOf(await call("admin", { domain: "system", action: "token_status" })),
  );
  assert.equal(status.logged_in, false);
});
