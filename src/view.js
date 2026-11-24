// 读视图：把云端快照加工成 App MCP 对等的查询/统计/概览/账户/流水/预算。
// 统计口径与 App 一致：默认排除「不计入收支」和「报销中」的账单。
import { round2 } from "./validate.js";
import { assetById, categoryInfo, tagNames, resolveAccount, resolveCategory, resolveTag, resolveBook, tax } from "./taxonomy.js";

export const TZ_MS = 8 * 3600 * 1000;
const pad = (n) => String(n).padStart(2, "0");
export function shifted(ms) { return new Date(Number(ms) + TZ_MS); }
export function fmtDate(ms) { const d = shifted(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
export function fmtTime(ms) { const d = shifted(ms); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; }
export function fmtDateTime(ms) { return `${fmtDate(ms)} ${fmtTime(ms)}`; }
export function currentMonth() { const d = shifted(Date.now()); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; }
export function monthRange(month) {
  const [y, m] = String(month).split("-").map(Number);
  const start = Date.UTC(y, m - 1, 1) - TZ_MS;
  const end = Date.UTC(y, m, 1) - TZ_MS - 1;
  return [start, end];
}
export function dateStartMs(s) { const [y, m, d] = String(s).split("-").map(Number); return Date.UTC(y, m - 1, d) - TZ_MS; }
export function dateEndMs(s) { return dateStartMs(s) + 86400000 - 1; }

export function isIncomeBill(bill) { return Number(bill.parentCategoryId) === 9; }
export function billTags(bill) {
  if (!bill.tags) return [];
  try {
    const arr = typeof bill.tags === "string" ? JSON.parse(bill.tags) : bill.tags;
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch { return []; }
}
export function inScope(bill, includeExcluded = false) {
  if (includeExcluded) return true;
  if (bill.notIntoTotal) return false;
  if (bill.reimbursement && !bill.reimbursementEnd) return false;
  return true;
}

export async function filterBills(snap, f = {}) {
  let list = (snap.Bill || []).slice();
  if (!f.include_excluded) list = list.filter((b) => inScope(b, false));
  let start;
  let end;
  if (f.month) [start, end] = monthRange(f.month);
  else {
    if (f.from) start = dateStartMs(f.from);
    if (f.to) end = dateEndMs(f.to);
  }
  if (start !== undefined) list = list.filter((b) => Number(b.time) >= start);
  if (end !== undefined) list = list.filter((b) => Number(b.time) <= end);
  if (f.account) {
    const a = await resolveAccount(f.account);
    list = list.filter((b) => Number(b.assetId) === a.id);
  }
  if (f.category) {
    const c = await resolveCategory(f.category);
    list = list.filter((b) => Number(b.parentCategoryId) === c.parentCategoryId
      && (c.childCategoryId ? Number(b.childCategoryId) === c.childCategoryId : true));
  }
  if (f.type === "income") list = list.filter(isIncomeBill);
  else if (f.type === "expense") list = list.filter((b) => !isIncomeBill(b));
  if (f.tag) {
    const t = await resolveTag(f.tag);
    list = list.filter((b) => billTags(b).includes(String(t.id)));
  }
  if (f.keyword) {
    const kw = String(f.keyword).toLowerCase();
    list = list.filter((b) => String(b.remark || "").toLowerCase().includes(kw));
  }
  if (f.min_amount !== undefined) list = list.filter((b) => Number(b.cost) >= Number(f.min_amount));
  if (f.max_amount !== undefined) list = list.filter((b) => Number(b.cost) <= Number(f.max_amount));
  if (f.book) {
    const bk = await resolveBook(f.book);
    list = list.filter((b) => Number(b.bookId) === bk.id);
  }
  list.sort((a, b) => Number(b.time) - Number(a.time));
  return list;
}

export async function compactBill(b) {
  const { parentName, childName } = await categoryInfo(b.parentCategoryId, b.childCategoryId);
  const acc = await assetById(b.assetId);
  const tnames = await tagNames(billTags(b));
  const cost = round2(b.cost);
  const discount = round2(b.discountNumber || 0);
  return {
    bill_id: Number(b.billId),
    time: fmtDateTime(b.time),
    cost,
    discount,
    original: round2(cost + discount),
    type: isIncomeBill(b) ? "income" : "expense",
    account: acc ? acc.name : String(b.assetId),
    category: parentName,
    sub_category: childName,
    remark: b.remark || "",
    tags: tnames,
    not_into_total: Boolean(b.notIntoTotal),
    not_into_budget: Boolean(b.notIntoBudget),
    reimbursement: Boolean(b.reimbursement),
    reimbursement_end: Boolean(b.reimbursementEnd),
    asset_id: Number(b.assetId),
    parent_category_id: Number(b.parentCategoryId),
    child_category_id: Number(b.childCategoryId),
    book_id: Number(b.bookId),
    bill_type: Number(b.billType || 0),
  };
}

export async function queryBills(snap, f = {}) {
  const list = await filterBills(snap, f);
  const offset = Number(f.offset || 0);
  const limit = Math.min(Number(f.limit || 50), 200);
  const page = list.slice(offset, offset + limit);
  const bills = [];
  for (const b of page) bills.push(await compactBill(b));
  return { count: list.length, offset, limit, total: round2(list.reduce((s, b) => s + Number(b.cost), 0)), bills };
}

function groupAdd(map, key, name, bill) {
  const cur = map.get(key) || { key, name, amount: 0, count: 0 };
  cur.amount = round2(cur.amount + Number(bill.cost));
  cur.count += 1;
  map.set(key, cur);
}

export async function statsView(snap, f = {}) {
  let list = await filterBills(snap, f);
  if (f.type === "income") list = list.filter(isIncomeBill);
  else if (f.type !== "all") list = list.filter((b) => !isIncomeBill(b));
  const by = f.by || "category";
  const groups = new Map();
  for (const b of list) {
    if (by === "day") groupAdd(groups, fmtDate(b.time), fmtDate(b.time), b);
    else if (by === "month") { const m = fmtDate(b.time).slice(0, 7); groupAdd(groups, m, m, b); }
    else if (by === "tag") {
      for (const id of billTags(b)) {
        const names = await tagNames([id]);
        groupAdd(groups, String(id), names[0] || String(id), b);
      }
    } else if (by === "sub_category") {
      const { parentName, childName } = await categoryInfo(b.parentCategoryId, b.childCategoryId);
      const name = childName ? `${parentName}-${childName}` : parentName;
      groupAdd(groups, `${b.parentCategoryId}-${b.childCategoryId}`, name, b);
    } else {
      const { parentName } = await categoryInfo(b.parentCategoryId, b.childCategoryId);
      groupAdd(groups, String(b.parentCategoryId), parentName, b);
    }
  }
  const total = round2([...groups.values()].reduce((s, g) => s + g.amount, 0));
  const out = [...groups.values()]
    .map((g) => ({ ...g, share: total ? round2((g.amount / total) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount);
  return { by, count: list.length, total, groups: out };
}

export async function overviewView(snap, f = {}) {
  const month = f.month || currentMonth();
  const [ms, me] = monthRange(month);
  const today = fmtDate(Date.now());
  const inScopeBills = (snap.Bill || []).filter((b) => inScope(b, false));
  const sum = (arr, kind) => round2(arr.filter((b) => (isIncomeBill(b) ? "income" : "expense") === kind)
    .reduce((s, b) => s + Number(b.cost), 0));
  const monthBills = inScopeBills.filter((b) => Number(b.time) >= ms && Number(b.time) <= me);
  const todayBills = inScopeBills.filter((b) => fmtDate(b.time) === today);
  const expense = sum(monthBills, "expense");
  const income = sum(monthBills, "income");
  const budgets = (snap.Budget || []).filter((x) => Number(x.year) === Number(month.slice(0, 4))
    && Number(x.month) === Number(month.slice(5, 7)));
  const totalBudget = round2(budgets.reduce((s, x) => s + Number(x.num || 0), 0));
  return {
    today: { date: today, expense: sum(todayBills, "expense"), income: sum(todayBills, "income") },
    month: { month, expense, income, balance: round2(income - expense) },
    budget: budgets.length ? { total: totalBudget, used: expense, remaining: round2(totalBudget - expense), items: budgets.map((b) => ({ name: b.budgetName || "月预算", num: round2(b.num || 0) })) } : null,
  };
}

export async function accountsView(snap) {
  const t = await tax();
  const funds = [];
  const credit = [];
  const debt = [];
  for (const a of t.assetList) {
    const obj = {
      name: a.assetName,
      balance: round2(a.assetNumber || 0),
      type: Number(a.assetType),
      group: a.groupName || "",
      quota: round2(a.totalQuota || 0),
    };
    if (a.groupName === "报销" || Number(a.assetType) === 9) continue;
    if (Number(a.assetType) === 1 || Number(a.assetType) === 3) {
      obj.available = round2((a.totalQuota || 0) + (a.assetNumber || 0));
      obj.statement_day = a.outAccountDate;
      obj.repayment_day = a.inAccountDate;
      funds.push(obj);
    } else if (Number(a.assetType) === 2) {
      obj.available = round2((a.totalQuota || 0) + (a.assetNumber || 0));
      obj.statement_day = a.outAccountDate;
      obj.repayment_day = a.inAccountDate;
      credit.push(obj);
    } else {
      debt.push(obj);
    }
  }
  const reimbBills = (snap.Bill || []).filter((b) => b.reimbursement && !b.reimbursementEnd);
  const reimbursement = [{
    name: "公司报销",
    balance: round2(reimbBills.reduce((s, b) => s + Number(b.cost || 0), 0)),
    count: reimbBills.length,
    group: "报销",
  }];
  const stocks = (snap.StockAsset || []).filter((s) => !s.hide);
  const costBasis = round2(stocks.reduce((s, x) => s + Number(x.primeCost || 0) * Number(x.primeNum || 0), 0));
  return {
    funds,
    credit,
    debt,
    reimbursement,
    investments: { count: stocks.length, cost_basis: costBasis, valuation: "cost", note: "云端接口无现价/市值，只有成本口径" },
  };
}

export async function flowView(snap, f = {}) {
  const acc = await resolveAccount(f.account);
  let start;
  let end;
  if (f.month) [start, end] = monthRange(f.month);
  else {
    if (f.from) start = dateStartMs(f.from);
    if (f.to) end = dateEndMs(f.to);
  }
  let events = (snap.AssetHistory || []).filter((e) => Number(e.assetId) === acc.id);
  if (start !== undefined) events = events.filter((e) => Number(e.time) >= start);
  if (end !== undefined) events = events.filter((e) => Number(e.time) <= end);
  events.sort((a, b) => Number(a.time) - Number(b.time));
  const limit = Math.min(Number(f.limit || 200), 500);
  const list = events.slice(-limit).map((e) => ({
    time: fmtDateTime(e.time),
    change: round2(e.changeNum),
    balance_after: round2(e.currentNum),
    note: e.changeContent || "",
  }));
  return { account: acc.name, count: list.length, events: list };
}

export async function budgetView(snap, f = {}) {
  const month = f.month || currentMonth();
  const [ms, me] = monthRange(month);
  const items = (snap.Budget || []).filter((x) => Number(x.year) === Number(month.slice(0, 4))
    && Number(x.month) === Number(month.slice(5, 7))).map((b) => ({ id: b.budgetId, name: b.budgetName || "月预算", num: round2(b.num || 0) }));
  const used = round2((snap.Bill || []).filter((b) => inScope(b, false) && !isIncomeBill(b)
    && Number(b.time) >= ms && Number(b.time) <= me).reduce((s, b) => s + Number(b.cost), 0));
  const total = round2(items.reduce((s, x) => s + x.num, 0));
  return { month, items, total, used, remaining: round2(total - used) };
}
