// 假官方 API：只实现 MCP 用到的端点，数据全内存。
import http from "node:http";

const TZ = 8 * 3600 * 1000;
export function ms(dateStr) {
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/);
  const [, y, mo, d, h = "0", mi = "0"] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi) - TZ;
}

function envelope(res, code, result, msg = "success") {
  const body = JSON.stringify({ code, msg, result });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(body);
}

export function createMock() {
  const state = {
    assets: [
      { id: 1, assetName: "农业银行储蓄卡", assetId: 2098484575, assetType: 1, assetNumber: 195.6, totalQuota: 0, intoTotalAsset: true, hide: false, groupName: "资金账户", userId: 1469378, updateTime: 1, outAccountDate: null, inAccountDate: null },
      { id: 2, assetName: "微信钱包", assetId: 500032074, assetType: 1, assetNumber: 2038.07, totalQuota: 0, intoTotalAsset: true, hide: false, groupName: "资金账户", userId: 1469378, updateTime: 1, outAccountDate: null, inAccountDate: null },
      { id: 3, assetName: "招商银行信用卡", assetId: 285858593, assetType: 2, assetNumber: -6272.44, totalQuota: 70234.26, intoTotalAsset: true, hide: false, groupName: "信贷账户", userId: 1469378, updateTime: 1, outAccountDate: 25, inAccountDate: 13 },
      { id: 4, assetName: "支付宝", assetId: 2045705021, assetType: 1, assetNumber: 62546.64, totalQuota: 0, intoTotalAsset: true, hide: false, groupName: "资金账户", userId: 1469378, updateTime: 1, outAccountDate: null, inAccountDate: null },
      { id: 5, assetName: "浦发银行储蓄卡", assetId: 68299530, assetType: 1, assetNumber: 0, totalQuota: 0, intoTotalAsset: true, hide: false, groupName: "资金账户", userId: 1469378, updateTime: 1, outAccountDate: null, inAccountDate: null },
      { id: 6, assetName: "公司报销", assetId: 1859268632, assetType: 9, assetNumber: 0, totalQuota: 0, intoTotalAsset: true, hide: false, groupName: "报销", userId: 1469378, updateTime: 1, outAccountDate: null, inAccountDate: null },
    ],
    books: [{ id: 746648, accountBookId: 1, bookName: "日常账本", userId: 1469378, type: 1, updateTime: 1 }],
    parents: [],
    children: [],
    tags: [],
    bills: [],
    transfers: [],
    refunds: [],
    assetHistory: [],
    budgets: [{ id: 1, budgetId: 1, budgetName: "月预算", year: 2026, month: 11, num: 5000, type: 1, userId: 1469378 }],
    stockAssets: [],
    assetIncome: [],
    inject: null,   // 测试用：{path, times, code?, httpStatus?} 模拟瞬时失败
    scanPolls: 0,   // 扫码状态轮询次数
  };
  const month = (() => { const d = new Date(Date.now() + TZ); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; })();
  const seed = (over) => ({
    id: 0, parentCategoryId: 7, childCategoryId: 707, remark: "", cost: 0,
    time: ms(`${month}-10 12:00`), recordTime: Date.now(), inAssetTime: 0, poiAddress: null, totalAddress: null,
    billType: 1, userId: 1469378, bookId: 1, billId: 0, updateTime: Date.now(), tags: "[]",
    assetId: 500032074, reimbursement: false, reimbursementEnd: false, fromUserId: 0,
    billShareInfo: "{}", notIntoTotal: false, notIntoBudget: false, currencyInfo: null,
    currencyAssetNumber: 0, discountNumber: 0, currencyDiscountNumber: 0, ...over,
  });
  state.bills.push(
    seed({ billId: 111111111, cost: 10, parentCategoryId: 7, childCategoryId: 707, remark: "午餐", time: ms(`${month}-10 12:00`) }),
    seed({ billId: 222222222, cost: 20, parentCategoryId: 9, childCategoryId: 904, remark: "工资", assetId: 2098484575, time: ms(`${month}-11 09:00`) }),
    seed({ billId: 333333333, cost: 5, parentCategoryId: 7, childCategoryId: 707, remark: "不计收支测试", notIntoTotal: true, time: ms(`${month}-12 10:00`), assetId: 2045705021 }),
    seed({ billId: 444444444, cost: 7, parentCategoryId: 7, childCategoryId: 708, remark: "报销中测试", reimbursement: true, reimbursementEnd: false, time: ms(`${month}-13 10:00`) }),
  );
  state.assetHistory.push(
    { id: 1, assetHistoryId: 1, assetId: 2098484575, time: ms(`${month}-10 08:00`), changeNum: -1, currentNum: 195.6, changeContent: "还款到招商银行信用卡", userId: 1469378, updateTime: 1 },
    { id: 2, assetHistoryId: 2, assetId: 2098484575, time: ms(`${month}-11 09:00`), changeNum: 20, currentNum: 215.6, changeContent: "新增账单：工资", userId: 1469378, updateTime: 1 },
  );

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const url = new URL(req.url, "http://localhost");
      const path = url.pathname.replace(/^\/api/, "");
      const json = () => { try { return body ? JSON.parse(body) : null; } catch { return null; } };
      if (state.inject && state.inject.path === path && state.inject.times > 0) {
        state.inject.times -= 1;
        if (state.inject.httpStatus) {
          res.writeHead(state.inject.httpStatus, { "content-type": "application/json" });
          return res.end(JSON.stringify({ code: state.inject.httpStatus, msg: "injected" }));
        }
        return envelope(res, state.inject.code === undefined ? 1 : state.inject.code, null, "injected");
      }
      // 扫码登录：第一次 pending，第二次成功（带顶层 token）
      if (path === "/scanLogin/addScanLogin") return envelope(res, 0, "scan-session-1");
      if (path.startsWith("/scanLogin/getScanLogin/")) {
        state.scanPolls += 1;
        if (state.scanPolls === 1) return envelope(res, 1, null, "no data");
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({
          code: 0,
          msg: "success",
          result: { id: 1469378, name: "测试用户", email: "test@example.com" },
          token: "jwt-test-token",
        }));
      }
      // 读：资产
      if (path.startsWith("/asset/getAsset/")) return envelope(res, 0, state.assets);
      // 读：全量快照
      if (path.startsWith("/updateTime/getUpdateDataPage/")) {
        return envelope(res, 0, {
          syncTime: Date.now(), StockAsset: state.stockAssets, Lend: [], ChildCategory: state.children,
          ParentCategory: state.parents, AssetHistory: state.assetHistory, AccountBook: state.books,
          Refund: state.refunds, Bill: state.bills, Transfer: state.transfers, Asset: state.assets,
          Budget: state.budgets, Reimbursement: [], Tag: state.tags, AssetIncome: state.assetIncome,
        });
      }
      // 写：账单
      if (path === "/bill/addOrUpdateBill") {
        const b = json() || {};
        const i = state.bills.findIndex((x) => Number(x.billId) === Number(b.billId));
        if (i >= 0) state.bills[i] = { ...state.bills[i], ...b }; else state.bills.push(b);
        return envelope(res, 0, null);
      }
      if (path === "/bill/addOrUpdateBillList") {
        const list = json() || [];
        for (const b of list) {
          const i = state.bills.findIndex((x) => Number(x.billId) === Number(b.billId));
          if (i >= 0) state.bills[i] = { ...state.bills[i], ...b }; else state.bills.push(b);
        }
        return envelope(res, 0, null);
      }
      if (path === "/bill/deleteBill") {
        const { billId } = json() || {};
        state.bills = state.bills.filter((b) => Number(b.billId) !== Number(billId));
        return envelope(res, 0, null);
      }
      // 写：转账/退款/资产/泛实体
      if (path === "/transfer/addOrUpdateTransfer") {
        const t = json() || {};
        const i = state.transfers.findIndex((x) => Number(x.transferId) === Number(t.transferId));
        if (i >= 0) state.transfers[i] = { ...state.transfers[i], ...t }; else state.transfers.push(t);
        return envelope(res, 0, null);
      }
      if (path === "/refund/addOrUpdateRefund") {
        const r = json() || {};
        const i = state.refunds.findIndex((x) => Number(x.refundId) === Number(r.refundId));
        if (i >= 0) state.refunds[i] = { ...state.refunds[i], ...r }; else state.refunds.push(r);
        return envelope(res, 0, null);
      }
      if (path === "/transfer/deleteTransfer") {
        const { transferId } = json() || {};
        state.transfers = state.transfers.filter((t) => Number(t.transferId) !== Number(transferId));
        return envelope(res, 0, null);
      }
      if (path === "/refund/deleteRefund") {
        const { refundId } = json() || {};
        state.refunds = state.refunds.filter((r) => Number(r.refundId) !== Number(refundId));
        return envelope(res, 0, null);
      }
      const entity = (() => {
        let m = path.match(/^\/asset\/addOrUpdateAsset$/); if (m) return ["assets", "assetId"];
        m = path.match(/^\/tag\/addOrUpdateTag$/); if (m) return ["tags", "tagId"];
        m = path.match(/^\/accountBook\/addOrUpdateAccountBook$/); if (m) return ["books", "accountBookId"];
        return null;
      })();
      if (entity) {
        const [arr, pk] = entity;
        const e = json() || {};
        const i = state[arr].findIndex((x) => Number(x[pk]) === Number(e[pk]));
        if (i >= 0) state[arr][i] = { ...state[arr][i], ...e }; else state[arr].push(e);
        return envelope(res, 0, null);
      }
      // 读：分页/计数/目录
      if (path.startsWith("/bill/getAccountBillPage/")) {
        return envelope(res, 0, { syncTime: Date.now(), hasMoreData: false, page: 0, billCount: state.bills.length, totals: { income: 0, expense: 0 }, bills: state.bills });
      }
      if (path.startsWith("/bill/getBillCount/")) return envelope(res, 0, state.bills.length);
      if (path.startsWith("/bill/getAccountLastTime/")) return envelope(res, 0, 0);
      if (path.startsWith("/accountBook/getShareAccount/")) return envelope(res, 0, []);
      if (path.startsWith("/currency/getCurrencyData/")) return envelope(res, 0, []);
      if (path.startsWith("/icon/getCategoryInfo/")) return envelope(res, 0, { colorIcon: [] });
      if (path.startsWith("/deleteHistory/getDeleteHistory/")) return envelope(res, 0, []);
      if (path.startsWith("/bookkeeping/rateLimit/sync/start")) return envelope(res, 200, { syncCount: 1, sessionId: "s1" });
      if (path.startsWith("/bookkeeping/rateLimit/sync/end")) return envelope(res, 200, { syncCount: 0 });
      return envelope(res, 1, null, "no data");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ state, base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
