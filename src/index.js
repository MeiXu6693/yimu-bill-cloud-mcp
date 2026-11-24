#!/usr/bin/env node
// 一木记账云端 MCP（自研）：stdio 传输。token 优先来自 YIMU_TOKEN，
// 否则使用本机保存的登录态（独立模式下由 login_start 扫码建立）。
//
// --list-tools  离线列出工具清单（JSON）后退出，不需要 YIMU_TOKEN；
//               供 DSH 兼容层、安装检查与 CI 使用。
// --version / --help 打印后退出；未知参数明确报错。
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CONFIG } from "./config.js";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

const USAGE = `用法: yimu-bill-cloud-mcp [选项]

选项:
  --help, -h       显示本帮助后退出
  --version, -v    显示版本后退出
  --list-tools     离线输出工具清单及 JSON Schema 后退出（不需要 token）

不带选项时以 stdio 运行 MCP 服务。

环境变量:
  YIMU_TOKEN       可选。已配置时直接使用 token 并跳过扫码登录；
                   未配置时由 login_start 管理登录态并自动保存。
  YIMU_USER_ID     可选。缺省时从 token 的 aud 推导。
  YIMU_TIMEOUT_MS  可选。上游请求超时，默认 30000。
`;

/** 离线列出工具清单（不需要 token）。 */
async function listTools() {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  await server.connect(serverTransport);
  const client = new Client({ name: "yimu-bill-cloud-mcp/list-tools", version: VERSION });
  try {
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    process.stdout.write(
      `${JSON.stringify(
        {
          name: "yimu-bill-cloud-mcp",
          version: VERSION,
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await client.close();
    await server.close();
  }
}

/**
 * 命令入口。
 * @param {string[]} argv
 * @returns {Promise<number | undefined>} 退出码；stdio 服务模式返回 undefined。
 */
async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`yimu-bill-cloud-mcp ${VERSION}\n`);
    return 0;
  }
  if (argv.includes("--list-tools")) {
    try {
      await listTools();
      return 0;
    } catch (error) {
      process.stderr.write(
        `[yimu-bill-cloud] 无法列出工具：${error && error.message ? error.message : error}\n`,
      );
      return 1;
    }
  }
  const unknown = argv.filter((arg) => arg.startsWith("-"));
  if (unknown.length > 0) {
    process.stderr.write(`[yimu-bill-cloud] 未知参数: ${unknown.join(" ")}\n${USAGE}`);
    return 2;
  }
  const server = createServer();
  await server.connect(new StdioServerTransport());
  process.stderr.write(
    CONFIG.token
      ? "[yimu-bill-cloud] ready\n"
      : "[yimu-bill-cloud] ready（未登录，可调用 login_start）\n",
  );
  return undefined;
}

const code = await main(process.argv.slice(2));
if (typeof code === "number") process.exitCode = code;
