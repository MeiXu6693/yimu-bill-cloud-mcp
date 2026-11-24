// 一木记账 API 客户端。
//
// 响应信封 {code, msg, result}（部分接口兼容 data）：
//   code===0 成功取 result；code===1 && msg==="no data" 成功无数据（null）；code===200 同步限流成功；
//   其余抛不含服务端原文的 YimuError。登录/扫码/查用户接口的顶层 token 自动刷新 JWT。
import { encryptPassword } from "./crypto.js";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
/** 统一错误：HTTP 失败、业务码失败、网络异常 */
export class YimuError extends Error {
    constructor(message) {
        super(message);
        this.name = "YimuError";
    }
}
export const OFFICIAL_API_BASE_URL = "https://yimubill.com/api";
const OFFICIAL_ORIGIN = new URL(OFFICIAL_API_BASE_URL).origin;
/** 凭据只可发送到官方 HTTPS 服务，包括独立的 /bookkeeping 路径。 */
function assertOfficialUrl(url) {
    if (url.origin !== OFFICIAL_ORIGIN || url.username || url.password || url.hash) {
        throw new YimuError("只允许访问一木官方 HTTPS 服务");
    }
}
/** 保留原配置项以便迁移，但不再接受自定义服务地址。 */
export function validateApiBaseUrl(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new YimuError("API 地址必须为 https://yimubill.com/api");
    }
    assertOfficialUrl(url);
    if (url.pathname.replace(/\/+$/, "") !== "/api" || url.search) {
        throw new YimuError("API 地址必须为 https://yimubill.com/api");
    }
    return OFFICIAL_API_BASE_URL;
}
/** 解析响应信封 → 业务结果；非成功抛 YimuError */
export function unwrapEnvelope(data) {
    if (data === null || typeof data !== "object")
        return data;
    const d = data;
    const code = d.code;
    if (code === 0)
        return (d.result !== undefined ? d.result : d.data) ?? null;
    if (code === 200)
        return (d.result !== undefined ? d.result : d.data) ?? d; // 同步限流接口：保留 syncCount/sessionId
    if (code === 1 && d.msg === "no data")
        return null;
    // 服务端错误文本可能回显密码或令牌，不进入模型输出和启动日志。
    const suffix = typeof code === "number" && Number.isFinite(code) ? ` (code=${code})` : "";
    throw new YimuError(`请求失败${suffix}`);
}
/** 账单归一化（app.js Fr() 移植） */
export function normalizeBill(bill) {
    const s = { ...bill };
    if (typeof s.billId === "number" && s.billId > 2147483647) {
        s.billId = Math.floor(Math.random() * 2147483647);
    }
    if (Array.isArray(s.tags))
        s.tags = JSON.stringify(s.tags);
    else if (s.tags === undefined || s.tags === null || s.tags === "")
        s.tags = "[]";
    if (!s.recordTime)
        s.recordTime = s.updateTime || Date.now();
    if (s.billShareInfo && typeof s.billShareInfo === "object") {
        s.billShareInfo = JSON.stringify(s.billShareInfo);
    }
    if (s.currencyInfo && typeof s.currencyInfo === "object") {
        s.currencyInfo = JSON.stringify(s.currencyInfo);
    }
    return s;
}
export class YimuClient {
    baseUrl;
    origin;
    timeoutMs;
    fetchImpl;
    /** 当前 JWT；登录/扫码/查用户成功后自动刷新（请求头 token 用） */
    token;
    /** userObjectToken（登录结果里的 token 字段，通常为邮箱）；getUserInfoById 表单用 */
    userToken;
    /** 当前用户 ID；登录成功后自动获取 */
    userId;
    constructor(opts) {
        this.baseUrl = validateApiBaseUrl(opts.baseUrl);
        this.origin = OFFICIAL_ORIGIN;
        this.token = opts.token ?? "";
        this.userToken = opts.userToken ?? "";
        this.userId = opts.userId !== undefined ? String(opts.userId) : "";
        this.timeoutMs = opts.timeoutMs ?? 30000;
        this.fetchImpl = opts.fetchImpl ?? fetch;
    }
    pathToUrl(path) {
        if (path.startsWith("/bookkeeping") || path.startsWith("bookkeeping")) {
            return `${this.origin}/${path.replace(/^\/+/, "")}`;
        }
        const p = path.replace(/^\/api\//, "/").replace(/^\//, "");
        return `${this.baseUrl}/${p}`;
    }
    /**
     * 核心请求。path 接受两种写法：`/user/getUserEmail`（相对 /api）或 `/api/user/getUserEmail`；
     * 同步限流接口写 `/bookkeeping/...`。返回解包后的业务结果。
     */
    async request(method, path, opts = {}) {
        let p = path;
        if (opts.params) {
            for (const [k, v] of Object.entries(opts.params))
                p = p.replaceAll(`{${k}}`, String(v));
        }
        let url;
        try {
            url = new URL(this.pathToUrl(p));
        }
        catch {
            throw new YimuError("接口路径无效");
        }
        if (opts.query)
            for (const [k, v] of Object.entries(opts.query))
                url.searchParams.set(k, String(v));
        assertOfficialUrl(url);
        const headers = {
            "user-agent": USER_AGENT,
            referer: `${this.origin}/`,
            accept: "application/json, text/plain, */*",
        };
        if (this.token)
            headers.token = this.token;
        let body;
        if (opts.form) {
            headers["content-type"] = "application/x-www-form-urlencoded";
            body = new URLSearchParams(opts.form).toString();
            headers.origin = this.origin;
        }
        else if (opts.body !== undefined) {
            headers["content-type"] = "application/json";
            body = JSON.stringify(opts.body);
            headers.origin = this.origin;
        }
        let res;
        try {
            res = await this.fetchImpl(url.toString(), {
                method,
                headers,
                body,
                signal: AbortSignal.timeout(this.timeoutMs),
                redirect: "error",
            });
        }
        catch {
            // 不保留原始错误或 cause：未捕获异常也可能把它们写入 stderr。
            throw new YimuError("网络请求失败（不允许重定向）");
        }
        if (!res.ok) {
            throw new YimuError(`HTTP ${res.status}`);
        }
        let data;
        try {
            data = await res.json();
        }
        catch {
            throw new YimuError("响应不是有效 JSON");
        }
        if (opts.raw)
            return data;
        // 登录/扫码/查用户接口的顶层 token 刷新 JWT
        if (data && typeof data === "object") {
            const d = data;
            if (typeof d.token === "string" && d.token && /(getUserEmail|getScanLogin|getUserInfoById)/.test(path)) {
                this.token = d.token;
            }
        }
        return unwrapEnvelope(data);
    }
    // ---------------- 认证 ----------------
    async loginByEmail(email, password) {
        const r = await this.request("POST", "/user/getUserEmail", {
            form: { email, password: encryptPassword(password) },
        });
        this.rememberUser(r);
        return r;
    }
    /** 从用户对象提取 userId（登录/扫码返回的字段是 id）并记住；同时记录 userObjectToken */
    rememberUser(u) {
        if (!u || typeof u !== "object")
            return;
        const obj = u;
        const id = obj.userId ?? obj.id;
        if (typeof id === "number" || typeof id === "string")
            this.userId = String(id);
        if (typeof obj.token === "string" && obj.token)
            this.userToken = obj.token;
    }
    async getUserInfoById(userId) {
        return this.request("POST", "/user/getUserInfoById", {
            form: { userId: String(userId), token: this.userToken || this.token },
        });
    }
    async getUserInfoBatch(userIds) {
        return this.request("POST", "/user/getUserInfo", { body: userIds });
    }
    /** 创建扫码登录会话，返回 sessionId（QR 内容为 `login:${sessionId}`） */
    async addScanLogin() {
        const r = (await this.request("POST", "/scanLogin/addScanLogin"));
        if (typeof r !== "string" || !r)
            throw new YimuError("扫码登录会话创建失败");
        return r;
    }
    /** 轮询扫码登录状态；未扫/未成功返回 null，成功后返回用户对象（token 已刷新） */
    async getScanLogin(sessionId) {
        const r = (await this.request("GET", `/scanLogin/getScanLogin/{id}`, {
            params: { id: sessionId },
        }));
        if (r && typeof r === "object") {
            this.rememberUser(r);
            return r;
        }
        return null;
    }
    // ---------------- 读取 ----------------
    getUpdateDataPage(userId, time) {
        return this.request("GET", "/updateTime/getUpdateDataPage/{userId}/{time}", {
            params: { userId, time },
        });
    }
    getDeleteHistory(userId, time) {
        return this.request("GET", "/deleteHistory/getDeleteHistory/{userId}/{time}", {
            params: { userId, time },
        });
    }
    getBillCount(userId) {
        return this.request("GET", "/bill/getBillCount/{userId}", { params: { userId } });
    }
    getAccountBillPage(userId, bookId, page) {
        return this.request("GET", "/bill/getAccountBillPage/{userId}/{bookId}/{page}", {
            params: { userId, bookId, page },
        });
    }
    getAccountLastTime(userId, bookId) {
        return this.request("GET", "/bill/getAccountLastTime/{userId}/{bookId}", { params: { userId, bookId } });
    }
    getShareAccount(userId) {
        return this.request("GET", "/accountBook/getShareAccount/{userId}", { params: { userId } });
    }
    getAccountMember(userId, bookId) {
        return this.request("GET", "/accountBook/getAccountMember/{userId}/{bookId}", { params: { userId, bookId } });
    }
    getAccountDeleteHistory(userId, ownerId, bookId, lastSyncTime) {
        return this.request("GET", "/accountBook/getAccountDeleteHistory/{userId}/{ownerId}/{bookId}/{lastSyncTime}", {
            params: { userId, ownerId, bookId, lastSyncTime },
        });
    }
    getAsset(userId, time) {
        return this.request("GET", "/asset/getAsset/{userId}/{time}", { params: { userId, time } });
    }
    getCurrencyData(userId) {
        return this.request("GET", "/currency/getCurrencyData/{userId}", { params: { userId } });
    }
    getCategoryInfo(userId) {
        return this.request("GET", "/icon/getCategoryInfo/{userId}", { params: { userId } });
    }
    /** 对象存储临时凭证：返回原始响应体（code/result 均保留） */
    async getSts(userId) {
        return this.request("GET", "/app/getSts/{userId}", { params: { userId }, raw: true });
    }
    async getStsNoVerify() {
        return this.request("GET", "/app/getStsNoVerify/", { raw: true });
    }
    // ---------------- 写入 ----------------
    addOrUpdateBill(bill) {
        return this.request("POST", "/bill/addOrUpdateBill", { body: normalizeBill(bill) });
    }
    /** 批量写账单：按 100 条一批，每批内 updateTime 递增（与网页端一致） */
    async addOrUpdateBillList(bills) {
        const CHUNK = 100;
        const results = [];
        let ts = Date.now();
        for (let i = 0; i < bills.length; i += CHUNK) {
            const chunk = bills.slice(i, i + CHUNK).map((b) => {
                ts += 1;
                return normalizeBill({ ...b, updateTime: ts });
            });
            const r = await this.request("POST", "/bill/addOrUpdateBillList", { body: chunk });
            if (Array.isArray(r))
                results.push(...r);
            else
                results.push(r);
        }
        return results;
    }
    deleteBill(billId, userId) {
        return this.request("POST", "/bill/deleteBill", {
            body: { billId, ...(userId !== undefined ? { userId } : {}) },
        });
    }
    /** 通用实体保存：POST /{domain}/{action} */
    addOrUpdateEntity(domain, action, body) {
        return this.request("POST", `/${domain}/${action}`, { body });
    }
    // ---------------- 同步限流会话 ----------------
    syncStart() {
        return this.request("POST", "/bookkeeping/rateLimit/sync/start");
    }
    syncEnd(sessionId) {
        return this.request("POST", "/bookkeeping/rateLimit/sync/end", {
            query: sessionId ? { sessionId } : {},
        });
    }
    // ---------------- 记账文本解析 ----------------
    parseBillText(userId, text) {
        return this.request("GET", "/bill/analysisBillInfoT/{userId}/{text}", {
            params: { userId, text: encodeURIComponent(text) },
        });
    }
}
