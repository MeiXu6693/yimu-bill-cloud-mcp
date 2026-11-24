import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AUTH_MANAGED } from "./config.js";
import { registerReadTools } from "./tools/read_top.js";
import { registerBillTools } from "./tools/bill_write.js";
import { registerTransferTools } from "./tools/transfer.js";
import { registerReportTools } from "./tools/grouped/report.js";
import { registerAdminTools } from "./tools/grouped/admin.js";
import { registerAuthTools } from "./tools/auth.js";
import { VERSION } from "./version.js";

export function createServer() {
  const server = new McpServer({ name: "yimu-bill-cloud", version: VERSION });
  registerReadTools(server);
  registerBillTools(server);
  registerTransferTools(server);
  registerReportTools(server);
  registerAdminTools(server);
  if (AUTH_MANAGED) registerAuthTools(server);
  return server;
}
