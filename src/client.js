// 官方网页 API 客户端：复用上游 MIT 的 api.js（vendor/），
// 提供本项目需要的薄封装；测试时通过 YIMU_MOCK_BASE 把域名重写到本地 mock。
import { YimuClient, normalizeBill, YimuError } from "../vendor/api.js";
import { CONFIG } from "./config.js";

const realFetch = globalThis.fetch.bind(globalThis);
const fetchImpl = CONFIG.mockBase
  ? (url, opts) => realFetch(String(url).replace("https://yimubill.com", CONFIG.mockBase), opts)
  : undefined;

export const client = new YimuClient({
  baseUrl: "https://yimubill.com/api",
  token: CONFIG.token,
  userId: CONFIG.userId,
  timeoutMs: CONFIG.timeoutMs,
  fetchImpl,
});

// 瞬时失败自动重试：网络错误/超时/HTTP 5xx；写请求额外重试 code=1（服务端偶发）。
// 重试耗尽后抛出“人话”错误，不把底层 code/堆栈暴露给模型与用户；YIMU_DEBUG=1 才写 stderr。
const RETRY_ATTEMPTS = Math.max(1, Number(process.env.YIMU_RETRY_ATTEMPTS || 3));
const RETRY_DELAY_MS = Math.max(1, Number(process.env.YIMU_RETRY_DELAY_MS || 300));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function failureKind(message, method) {
  const m = String(message || "");
  if (/网络请求失败|fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|socket hang up|aborted|超时/i.test(m)) return "network";
  if (/HTTP 5\d\d/.test(m)) return "server";
  if (String(method).toUpperCase() === "POST" && /请求失败 \(code=1\)/.test(m)) return "write";
  return null;
}

function friendlyError(kind) {
  const suffix = `（已自动重试 ${RETRY_ATTEMPTS} 次）`;
  if (kind === "network") return new YimuError("云端网络暂时不可用" + suffix + "，请稍后再试");
  if (kind === "server") return new YimuError("云端服务暂时不可用" + suffix + "，请稍后再试");
  return new YimuError("云端写入暂时失败" + suffix + "，请稍后再试");
}

const originalRequest = client.request.bind(client);
client.request = async (method, path, opts = {}) => {
  let lastError;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await originalRequest(method, path, opts);
    } catch (e) {
      lastError = e;
      const kind = failureKind(e && e.message, method);
      if (!kind) throw e;
      if (attempt >= RETRY_ATTEMPTS) throw friendlyError(kind);
      if (process.env.YIMU_DEBUG === "1") {
        process.stderr.write(`[yimu-bill-cloud] retry ${attempt}/${RETRY_ATTEMPTS} ${method} ${path}: ${e.message}\n`);
      }
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError;
};

export { YimuError };

export async function getAssets() {
  const r = await client.getAsset(CONFIG.userId, 0);
  return Array.isArray(r) ? r : [];
}

export async function getSnapshot() {
  const r = await client.getUpdateDataPage(CONFIG.userId, 0);
  return r && typeof r === "object" ? r : {};
}

export async function saveBill(bill) {
  return client.addOrUpdateBill(normalizeBill(bill));
}

export async function saveBills(bills) {
  return client.addOrUpdateBillList(bills.map(normalizeBill));
}

export async function deleteBill(billId) {
  return client.deleteBill(String(billId), CONFIG.userId);
}

export async function saveEntity(domain, action, entity) {
  return client.addOrUpdateEntity(domain, action, entity);
}

export async function getBillCount() {
  return client.getBillCount(CONFIG.userId);
}

export async function getBookBills(bookId, page = 0) {
  return client.getAccountBillPage(CONFIG.userId, bookId, page);
}

export async function getDeleteHistory(time = 0) {
  return client.getDeleteHistory(CONFIG.userId, time);
}

export async function getShareAccounts() {
  return client.getShareAccount(CONFIG.userId);
}

export async function getAccountMembers(bookId) {
  return client.getAccountMember(CONFIG.userId, bookId);
}

export async function getCategoriesInfo() {
  return client.getCategoryInfo(CONFIG.userId);
}

export async function getCurrency() {
  return client.getCurrencyData(CONFIG.userId);
}

export async function parseBillText(text) {
  return client.parseBillText(CONFIG.userId, encodeURIComponent(text));
}

export async function syncStart() {
  return client.syncStart();
}

export async function syncEnd(sessionId) {
  return client.syncEnd(sessionId);
}
