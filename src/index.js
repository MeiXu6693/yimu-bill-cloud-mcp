#!/usr/bin/env node
// 一木记账云端 MCP（自研）：stdio 传输，token/userId 从环境变量读取。
//
// --list-tools  离线列出工具清单（JSON）后退出，不需要 YIMU_TOKEN；
//               供 DSH 兼容层、安装检查与 CI 使用。
// --version     打印版本后退出。
import { readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { assertConfig } from "./config.js";
import { createServer } from "./server.js";

const argv = process.argv.slice(2);
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

if (argv.includes("--version") || argv.includes("-v")) {
  process.stdout.write(`yimu-bill-cloud-mcp ${packageJson.version}\n`);
  process.exit(0);
}

if (argv.includes("--list-tools")) {
  try {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    await server.connect(serverTransport);
    const client = new Client({ name: "yimu-bill-cloud-mcp/list-tools", version: packageJson.version });
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    await client.close();
    process.stdout.write(
      `${JSON.stringify(
        {
          name: "yimu-bill-cloud-mcp",
          version: packageJson.version,
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
    process.exit(0);
  } catch (error) {
    process.stderr.write(`[yimu-bill-cloud] 无法列出工具：${error && error.message ? error.message : error}\n`);
    process.exit(1);
  }
}

try {
  assertConfig();
} catch (e) {
  process.stderr.write(`[yimu-bill-cloud] ${e.message}\n`);
  process.exit(1);
}

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[yimu-bill-cloud] ready\n");
