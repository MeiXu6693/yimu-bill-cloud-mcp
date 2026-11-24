#!/usr/bin/env node
// 一木记账云端 MCP（自研）：stdio 传输，token/userId 从环境变量读取。
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { assertConfig } from "./config.js";
import { createServer } from "./server.js";

try {
  assertConfig();
} catch (e) {
  process.stderr.write(`[yimu-cloud] ${e.message}\n`);
  process.exit(1);
}

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[yimu-cloud] ready\n");
