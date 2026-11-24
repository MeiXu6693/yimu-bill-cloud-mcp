import { z } from "zod";
import QRCode from "qrcode";
import { clearAuth, client, syncConfigFromClient } from "../client.js";
import { clearStoredAuth, saveStoredAuth } from "../auth-store.js";

const SESSION_TTL_MS = 120_000;
const MAX_SESSIONS = 8;

/** 未完成的扫码会话：sessionId -> 过期时间。 */
const sessions = new Map();

function message(error) {
  return String((error && error.message) || error);
}

function jsonContent(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorContent(text) {
  return { isError: true, content: [{ type: "text", text }] };
}

/**
 * 终端二维码：用 Unicode 半块字符，不加 ANSI 颜色，直接粘到聊天/终端即可扫。
 * 静区 4 模块；每行字符覆盖 2 个模块。
 */
function terminalQr(text) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = modules.size;
  const quiet = 4;
  const total = size + quiet * 2;
  const dark = (row, col) =>
    row >= 0 && col >= 0 && row < size && col < size && Boolean(modules.data[row * size + col]);
  const lines = [];
  for (let row = 0; row < total; row += 2) {
    let line = "";
    for (let col = 0; col < total; col += 1) {
      const top = dark(row - quiet, col - quiet);
      const bottom = dark(row + 1 - quiet, col - quiet);
      line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    lines.push(line);
  }
  return lines.join("\n");
}

function purgeSessions() {
  const now = Date.now();
  for (const [id, expiresAt] of sessions) {
    if (now >= expiresAt) sessions.delete(id);
  }
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

export function registerAuthTools(server) {
  server.registerTool(
    "login_start",
    {
      description:
        "首次使用或需要重新登录时调用：生成一木记账扫码登录二维码。扫码后调用 login_poll；登录成功会自动保存登录态。",
      inputSchema: {},
    },
    async () => {
      try {
        const sessionId = await client.addScanLogin();
        sessions.set(sessionId, Date.now() + SESSION_TTL_MS);
        purgeSessions();
        const qrText = `login:${sessionId}`;
        const [terminal, png] = await Promise.all([
          Promise.resolve(terminalQr(qrText)),
          QRCode.toBuffer(qrText, { type: "png", margin: 1, width: 320 }),
        ]);
        return {
          content: [
            {
              type: "text",
              text: [
                `请用一木记账 App 扫描二维码登录（约 ${Math.round(SESSION_TTL_MS / 1000)} 秒有效）。`,
                `扫码后调用 login_poll，session_id: ${sessionId}`,
                "",
                terminal,
              ].join("\n"),
            },
            { type: "image", data: png.toString("base64"), mimeType: "image/png" },
          ],
        };
      } catch (error) {
        return errorContent(`创建扫码会话失败：${message(error)}`);
      }
    },
  );

  server.registerTool(
    "login_poll",
    {
      description:
        "轮询扫码登录结果；成功后自动保存登录态，不需要手动配置 token。",
      inputSchema: {
        session_id: z.string().describe("login_start 返回的 session_id"),
      },
    },
    async ({ session_id }) => {
      const expiresAt = sessions.get(session_id);
      if (!expiresAt || Date.now() >= expiresAt) {
        sessions.delete(session_id);
        return jsonContent({ status: "expired" });
      }
      try {
        const user = await client.getScanLogin(session_id);
        if (!user) return jsonContent({ status: "pending" });
        sessions.delete(session_id);
        syncConfigFromClient();
        let persisted = true;
        try {
          saveStoredAuth(client.token, client.userId);
        } catch {
          persisted = false;
        }
        return jsonContent({
          status: "ok",
          user_id: client.userId,
          user_name: String(user.name || user.userName || ""),
          persisted,
        });
      } catch (error) {
        return errorContent(`查询扫码状态失败：${message(error)}`);
      }
    },
  );

  server.registerTool(
    "logout",
    {
      description: "清除本机保存的一木记账登录态；不会让服务端 token 失效。",
      inputSchema: {},
    },
    async () => {
      clearAuth();
      sessions.clear();
      try {
        clearStoredAuth();
      } catch {
        // 删除失败不影响内存态已清空。
      }
      return jsonContent({ logged_out: true });
    },
  );
}
