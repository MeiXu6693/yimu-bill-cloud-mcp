import test from "node:test";
import assert from "node:assert/strict";
import { createMock, ms } from "./mock-server.mjs";

let mock;
let client;
let call;
let month;

function asset(name) {
  return mock.state.assets.find((a) => a.assetName === name);
}
function balance(name) {
  return Number(asset(name).assetNumber);
}
function round2(v) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

test.before(async () => {
  mock = await createMock();
  Object.assign(process.env, {
    YIMU_MOCK_BASE: mock.base,
    YIMU_TOKEN: "test-token",
    YIMU_USER_ID: "1469378",
    YIMU_CACHE_TTL_MS: "0",
    YIMU_TAXONOMY_TTL_MS: "0",
    YIMU_RETRY_DELAY_MS: "1",
  });
  const { createServer } = await import("../src/server.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  await server.connect(st);
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(ct);
  call = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = res.content?.[0]?.text ?? "{}";
    if (res.isError) return { __error: text };
    return JSON.parse(text);
  };
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
});

test.after(async () => {
  if (client) await client.close();
  if (mock) await mock.close();
});

test("overview / query / stats 口径：排除不计收支与报销中", async () => {
  const ov = await call("overview", { month });
  assert.equal(ov.month.expense, 10);
  assert.equal(ov.month.income, 20);
  assert.equal(ov.month.balance, 10);

  const q = await call("query_bills", { month });
  assert.equal(q.count, 2);
  const qAll = await call("query_bills", { month, include_excluded: true });
  assert.equal(qAll.count, 4);

  const st = await call("stats", { by: "category", month });
  assert.equal(st.total, 10);
  assert.deepEqual(st.groups.map((g) => g.name), ["食品餐饮"]);
});

test("bill_add：完整 payload + 优惠 + 余额自动校正", async () => {
  const before = balance("微信钱包");
  const res = await call("bill_add", {
    account: "微信钱包",
    category: "食品餐饮-午餐",
    amount: 12.34,
    discount: 0.66,
    time: `${month}-20 12:30`,
    remark: "测试午餐",
    tags: [],
  });
  assert.ok(res.bill_id > 1e8);
  assert.equal(round2(balance("微信钱包")), round2(before - 12.34));
  const saved = mock.state.bills.find((b) => Number(b.billId) === res.bill_id);
  assert.equal(saved.cost, 12.34);
  assert.equal(saved.discountNumber, 0.66);
  assert.equal(saved.parentCategoryId, 7);
  assert.equal(saved.childCategoryId, 707);
  assert.equal(saved.inAssetTime, 0);
  assert.ok(saved.billShareInfo);
  assert.equal(saved.billType, 1);
  globalThis.__billForUpdate = res.bill_id;
});

test("bills_add：同一秒同额多笔逐笔保留，不合并", async () => {
  const before = balance("支付宝");
  const items = [1, 2, 3].map(() => ({
    account: "支付宝",
    category: "食品餐饮-午餐",
    amount: 1.01,
    time: `${month}-21 08:00`,
    remark: "同秒同额",
  }));
  const res = await call("bills_add", { bills: items });
  assert.equal(res.created.length, 3);
  assert.equal(new Set(res.created.map((c) => c.bill_id)).size, 3);
  assert.equal(round2(balance("支付宝")), round2(before - 3.03));
  const q = await call("query_bills", { month, keyword: "同秒同额", include_excluded: true });
  assert.equal(q.count, 3);
});

test("bill_update：按新旧差额校正余额", async () => {
  const id = globalThis.__billForUpdate;
  const before = balance("微信钱包");
  const res = await call("bill_update", { bill_id: id, amount: 20 });
  assert.equal(res.bill_id, id);
  assert.equal(round2(balance("微信钱包")), round2(before - (20 - 12.34)));
  const saved = mock.state.bills.find((b) => Number(b.billId) === id);
  assert.equal(saved.cost, 20);
});

test("bill_delete：删单反向校正余额，必须 confirm", async () => {
  const id = globalThis.__billForUpdate;
  const before = balance("微信钱包");
  const denied = await call("bill_delete", { bill_id: id });
  assert.ok(denied.__error);
  const res = await call("bill_delete", { bill_id: id, confirm: true });
  assert.equal(res.deleted, true);
  assert.equal(round2(balance("微信钱包")), round2(before + 20));
  assert.ok(!mock.state.bills.some((b) => Number(b.billId) === id));
});

test("bill_add 幂等：显式 bill_id 重复调用不重复建单", async () => {
  const billId = 185000001;
  const first = await call("bill_add", {
    account: "浦发银行储蓄卡", category: "其他", amount: 0.01,
    time: `${month}-22 09:00`, remark: "幂等测试", bill_id: billId,
  });
  assert.equal(first.bill_id, billId);
  const countAfterFirst = mock.state.bills.length;
  const second = await call("bill_add", {
    account: "浦发银行储蓄卡", category: "其他", amount: 0.01,
    time: `${month}-22 09:00`, remark: "幂等测试", bill_id: billId,
  });
  assert.equal(second.__error, undefined);
  assert.equal(second.bill_id, undefined);
  assert.deepEqual(second.skipped_existing, [billId]);
  assert.equal(mock.state.bills.length, countAfterFirst);
});

test("transfer_add：优惠自动建收入账单、serviceCharge 与双方余额", async () => {
  const abcBefore = balance("农业银行储蓄卡");
  const cmbBefore = balance("招商银行信用卡");
  const res = await call("transfer_add", {
    from: "农业银行储蓄卡",
    to: "招商银行信用卡",
    amount: 1,
    discount: 6,
    time: `${month}-23 19:00`,
    remark: "还款优惠",
  });
  assert.ok(res.transfer_id > 1e8);
  const transfer = mock.state.transfers.find((t) => Number(t.transferId) === res.transfer_id);
  assert.equal(transfer.cost, 7);
  assert.equal(transfer.toCost, 7);
  assert.equal(transfer.serviceCharge, -6);
  assert.equal(Number(transfer.billId), res.discount_bill_id);
  const discountBill = mock.state.bills.find((b) => Number(b.billId) === res.discount_bill_id);
  assert.equal(discountBill.cost, 6);
  assert.equal(discountBill.parentCategoryId, 9);
  assert.equal(round2(balance("农业银行储蓄卡")), round2(abcBefore - 7 + 6));
  assert.equal(round2(balance("招商银行信用卡")), round2(cmbBefore + 7));

  // 删除转账：双方余额还原，关联优惠收入账单一起删除
  const del = await call("admin", { domain: "payment", action: "transfer_delete", confirm: true, params: { transfer_id: res.transfer_id } });
  assert.equal(del.deleted, true);
  assert.equal(round2(balance("农业银行储蓄卡")), round2(abcBefore));
  assert.equal(round2(balance("招商银行信用卡")), round2(cmbBefore));
  assert.ok(!mock.state.transfers.some((t) => Number(t.transferId) === res.transfer_id));
  assert.ok(!mock.state.bills.some((b) => Number(b.billId) === res.discount_bill_id));
});

test("admin payment.refund：退款记录 + 余额", async () => {
  const before = balance("微信钱包");
  const res = await call("admin", {
    domain: "payment",
    action: "refund",
    confirm: true,
    params: { bill_id: 111111111, amount: 3, to_account: "微信钱包", remark: "退款测试" },
  });
  assert.ok(res.refund_id > 1e8);
  assert.equal(round2(balance("微信钱包")), round2(before + 3));
  const refund = mock.state.refunds.find((r) => Number(r.refundId) === res.refund_id);
  assert.equal(refund.billId, 111111111);
  assert.ok(JSON.parse(refund.refundInfos)[0].assetNum);

  // 删除退款：余额还原
  const del = await call("admin", { domain: "payment", action: "refund_delete", confirm: true, params: { refund_id: res.refund_id } });
  assert.equal(del.deleted, true);
  assert.equal(round2(balance("微信钱包")), round2(before));
  assert.ok(!mock.state.refunds.some((r) => Number(r.refundId) === res.refund_id));
});

test("admin payment.asset_adjust：直接改资产余额", async () => {
  const res = await call("admin", { domain: "payment", action: "asset_adjust", params: { account: "支付宝", amount: 60000 } });
  assert.equal(res.after, 60000);
  assert.equal(balance("支付宝"), 60000);
});

test("admin entity save：泛实体写入（标签）", async () => {
  const res = await call("admin", { domain: "entity", action: "save", type: "tag", entity: { tagName: "测试标签" } });
  assert.equal(res.saved, true);
  assert.ok(mock.state.tags.some((t) => t.tagName === "测试标签"));
});

test("report flow / holdings / books", async () => {
  const flow = await call("report", { type: "flow", account: "农业银行储蓄卡", month });
  assert.equal(flow.account, "农业银行储蓄卡");
  assert.ok(flow.events.length >= 2);
  assert.ok(flow.events[0].balance_after !== undefined);

  const hold = await call("report", { type: "holdings" });
  assert.equal(hold.valuation, "cost");
  assert.ok(Array.isArray(hold.holdings));

  const books = await call("report", { type: "books" });
  assert.equal(books.books[0].name, "日常账本");
});

test("校验：未知分类/账户直接报错且不写单", async () => {
  const count = mock.state.bills.length;
  const cat = await call("bill_add", { account: "微信钱包", category: "不存在的分类", amount: 1 });
  assert.ok(cat.__error && cat.__error.includes("找不到分类"));
  const acc = await call("bill_add", { account: "不存在的账户", category: "其他", amount: 1 });
  assert.ok(acc.__error && acc.__error.includes("找不到账户"));
  assert.equal(mock.state.bills.length, count);
});

test("瞬时失败自动重试：HTTP 5xx 2 次后成功，模型无感", async () => {
  mock.state.inject = { path: "/transfer/addOrUpdateTransfer", httpStatus: 500, times: 2 };
  const res = await call("transfer_add", {
    from: "微信钱包", to: "支付宝", amount: 0.01, discount: 0.01,
    time: `${month}-24 06:00`, remark: "重试测试",
  });
  mock.state.inject = null;
  assert.ok(res.transfer_id > 1e8);
  assert.equal(res.discount, 0.01);
  // 清理，避免影响后续用例
  await call("admin", { domain: "payment", action: "transfer_delete", confirm: true, params: { transfer_id: res.transfer_id } });
});

test("重试耗尽：不暴露 code/堆栈，只给友好提示", async () => {
  const beforeBills = mock.state.bills.length;
  mock.state.inject = { path: "/transfer/addOrUpdateTransfer", code: 1, times: 99 };
  const res = await call("transfer_add", {
    from: "微信钱包", to: "支付宝", amount: 0.01, discount: 0.01,
    time: `${month}-24 06:10`, remark: "重试失败测试",
  });
  mock.state.inject = null;
  assert.ok(res.__error);
  assert.ok(!/code=1/.test(res.__error));
  assert.ok(/暂时/.test(res.__error));
  // 失败后关联的收入账单应被回滚
  assert.equal(mock.state.bills.length, beforeBills);
});

test("admin system token_status / refresh_cache", async () => {
  const tk = await call("admin", { domain: "system", action: "token_status" });
  assert.equal(tk.logged_in, true);
  assert.equal(tk.user_id, "1469378");
  const rf = await call("admin", { domain: "system", action: "refresh_cache" });
  assert.equal(rf.refreshed, true);
});
