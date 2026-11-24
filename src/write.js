// 语义写入层：名称解析 → 完整 payload → 校验 → 云端写入 → 余额校正 → 回读。
import { CONFIG } from "./config.js";
import { deleteBill, saveBill, saveBills, saveEntity } from "./client.js";
import { invalidate, snapshot, waitFor } from "./cache.js";
import { assertBill, assertRefund, assertTransfer, round2, ValidationError } from "./validate.js";
import { aggregate, applyEffects, billEffect, negate, refundEffects, transferEffects } from "./balance.js";
import { categoryInfo, resolveAccount, resolveBook, resolveCategory, resolveTag } from "./taxonomy.js";

const TZ_MS = 8 * 3600 * 1000;

export function nextId() {
  return Math.floor(1e8 + Math.random() * (2147483647 - 1e8));
}

export function parseTime(v, fallbackMs = Date.now()) {
  if (v === undefined || v === null || v === "") return fallbackMs;
  if (typeof v === "number") return v > 1e12 ? v : Math.round(v * 1000);
  const s = String(v).trim();
  if (/^\d{13}$/.test(s)) return Number(s);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/);
  if (m) {
    const [, y, mo, d, h = "0", mi = "0"] = m;
    return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)) - TZ_MS;
  }
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new ValidationError(`时间格式无效：${s}`);
  return t;
}

export async function resolveTags(tags) {
  if (tags === undefined || tags === null || tags === "") return [];
  const arr = Array.isArray(tags) ? tags : String(tags).split(/[,，;；]/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const t of arr) {
    const tag = await resolveTag(t);
    if (tag) out.push(tag.id);
  }
  return out;
}

export async function buildBill(item) {
  if (!item || typeof item !== "object") throw new ValidationError("账单对象无效");
  const acc = await resolveAccount(item.account);
  let categoryInput = item.category;
  if (item.sub_category && String(item.category).indexOf("-") < 0) categoryInput = `${item.category}-${item.sub_category}`;
  const cat = await resolveCategory(categoryInput);
  const book = await resolveBook(item.book);
  const tags = await resolveTags(item.tags);
  const timeMs = parseTime(item.time, Date.now());
  const nowMs = Date.now();
  const cost = round2(item.amount);
  const discount = round2(item.discount || 0);
  if (!(cost > 0)) throw new ValidationError("amount 必须 > 0");
  if (discount < 0) throw new ValidationError("discount 不能为负");
  const info = await categoryInfo(cat.parentCategoryId, cat.childCategoryId);
  const bill = {
    userId: Number(CONFIG.userId),
    bookId: book.id,
    billId: item.bill_id ? Number(item.bill_id) : nextId(),
    assetId: Number(acc.id),
    parentCategoryId: cat.parentCategoryId,
    childCategoryId: cat.childCategoryId,
    cost,
    discountNumber: discount,
    time: timeMs,
    recordTime: nowMs,
    inAssetTime: 0,
    billType: 1,
    updateTime: nowMs,
    tags: JSON.stringify(tags),
    remark: String(item.remark || "").slice(0, 80),
    billShareInfo: JSON.stringify({ assetName: acc.name, parentCategoryName: info.parentName, childCategoryName: info.childName }),
    notIntoTotal: Boolean(item.not_into_total),
    notIntoBudget: Boolean(item.not_into_budget),
    reimbursement: Boolean(item.reimbursement),
    reimbursementEnd: false,
    fromUserId: 0,
    currencyInfo: item.currency ? JSON.stringify(item.currency) : null,
    currencyAssetNumber: round2(item.currency_asset_number || 0),
    currencyDiscountNumber: round2(item.currency_discount_number || 0),
    poiAddress: item.poi_address || null,
    totalAddress: item.total_address || null,
  };
  assertBill(bill);
  return bill;
}

async function softConfirm(predicate, timeoutMs = 12000) {
  try {
    await waitFor(predicate, { timeoutMs, intervalMs: 1000 });
    return true;
  } catch {
    return false;
  }
}

export async function createBills(items, { verify = true } = {}) {
  if (!Array.isArray(items) || !items.length) throw new ValidationError("bills 不能为空");
  const snap = await snapshot();
  const existing = new Set((snap.Bill || []).map((b) => Number(b.billId)));
  const bills = [];
  const skipped = [];
  for (const item of items) {
    if (item.bill_id && existing.has(Number(item.bill_id))) {
      skipped.push(Number(item.bill_id));
      continue;
    }
    const bill = await buildBill(item);
    while (existing.has(bill.billId)) bill.billId = nextId();
    existing.add(bill.billId);
    bills.push(bill);
  }
  if (bills.length) await saveBills(bills);
  if (!bills.length) return { created: [], skipped_existing: skipped, assets_after: {}, verified: true };
  invalidate();
  const verified = await softConfirm((s) => bills.every((b) => (s.Bill || []).some((x) => Number(x.billId) === b.billId)));
  const effects = aggregate(bills.map(billEffect));
  const assets_after = await applyEffects(effects, { verify });
  return {
    created: bills.map((b) => ({ bill_id: b.billId, time: b.time, cost: b.cost, discount: b.discountNumber })),
    skipped_existing: skipped,
    assets_after,
    verified,
  };
}

async function findBill(billId) {
  const id = Number(billId);
  let snap = await snapshot();
  let bill = (snap.Bill || []).find((b) => Number(b.billId) === id);
  if (!bill) {
    snap = await snapshot({ force: true });
    bill = (snap.Bill || []).find((b) => Number(b.billId) === id);
  }
  if (!bill) throw new Error(`账单 ${billId} 不存在（云端快照里没有）`);
  return bill;
}

export async function updateBill(params = {}) {
  if (!params.bill_id) throw new ValidationError("缺少 bill_id");
  const old = await findBill(params.bill_id);
  const next = { ...old };
  const changed = [];
  const set = (k, v) => { next[k] = v; changed.push(k); };
  if (params.amount !== undefined) { set("cost", round2(params.amount)); if (!(next.cost > 0)) throw new ValidationError("amount 必须 > 0"); }
  if (params.discount !== undefined) set("discountNumber", round2(params.discount));
  if (params.account !== undefined) {
    const acc = await resolveAccount(params.account);
    set("assetId", Number(acc.id));
  }
  if (params.category !== undefined || params.sub_category !== undefined) {
    let input = params.category;
    if (input === undefined) {
      const { parentName } = await categoryInfo(old.parentCategoryId, old.childCategoryId);
      input = params.sub_category ? `${parentName}-${params.sub_category}` : parentName;
    } else if (params.sub_category && String(input).indexOf("-") < 0) {
      input = `${input}-${params.sub_category}`;
    }
    const cat = await resolveCategory(input);
    set("parentCategoryId", cat.parentCategoryId);
    set("childCategoryId", cat.childCategoryId);
  }
  if (params.time !== undefined) set("time", parseTime(params.time, old.time));
  if (params.remark !== undefined) set("remark", String(params.remark).slice(0, 80));
  if (params.clear_tags) set("tags", JSON.stringify([]));
  else if (params.tags !== undefined) set("tags", JSON.stringify(await resolveTags(params.tags)));
  if (params.not_into_total !== undefined) set("notIntoTotal", Boolean(params.not_into_total));
  if (params.not_into_budget !== undefined) set("notIntoBudget", Boolean(params.not_into_budget));
  if (params.reimbursement !== undefined) set("reimbursement", Boolean(params.reimbursement));
  next.updateTime = Date.now();
  next.recordTime = old.recordTime || Date.now();
  next.inAssetTime = 0;
  const acc = await resolveAccount(next.assetId);
  const info = await categoryInfo(next.parentCategoryId, next.childCategoryId);
  next.billShareInfo = JSON.stringify({ assetName: acc.name, parentCategoryName: info.parentName, childCategoryName: info.childName });
  assertBill(next);
  const effects = aggregate([billEffect(next), negate(billEffect(old))]);
  await saveBill(next);
  invalidate();
  const verified = await softConfirm((s) => (s.Bill || []).some((b) => Number(b.billId) === Number(next.billId) && Number(b.updateTime) >= Number(next.updateTime) - 1000));
  const assets_after = await applyEffects(effects, { verify: true });
  return { bill_id: Number(next.billId), changed, assets_after, verified };
}

export async function deleteBillById(params = {}) {
  if (!params.bill_id) throw new ValidationError("缺少 bill_id");
  if (params.confirm !== true) throw new ValidationError("删除账单需要 confirm:true");
  const old = await findBill(params.bill_id);
  const effects = negate(billEffect(old));
  await deleteBill(old.billId);
  invalidate();
  const verified = await softConfirm((s) => !(s.Bill || []).some((b) => Number(b.billId) === Number(old.billId)));
  const assets_after = await applyEffects(effects, { verify: true });
  return { deleted: true, bill_id: Number(old.billId), assets_after, verified };
}

export async function addTransfer(item = {}) {
  const from = await resolveAccount(item.from);
  const to = await resolveAccount(item.to);
  if (Number(from.id) === Number(to.id)) throw new ValidationError("转出/转入账户不能相同");
  const amount = round2(item.amount);
  if (!(amount > 0)) throw new ValidationError("amount 必须 > 0");
  const discount = round2(item.discount || 0);
  const fee = round2(item.fee || 0);
  if (discount < 0) throw new ValidationError("discount 不能为负");
  const toAmount = round2(item.to_amount !== undefined ? item.to_amount : amount + discount);
  const timeMs = parseTime(item.time, Date.now());
  const nowMs = Date.now();
  let discountBill = null;
  if (discount > 0) {
    discountBill = await buildBill({
      account: from.name,
      category: "收入-其他",
      amount: discount,
      time: item.time,
      remark: `${from.name} 转账优惠`,
      book: item.book,
    });
  }
  const transfer = {
    transferId: nextId(),
    userId: Number(CONFIG.userId),
    cost: toAmount,
    toCost: toAmount,
    serviceCharge: round2(fee - discount),
    fromAssetId: Number(from.id),
    toAssetId: Number(to.id),
    time: timeMs,
    updateTime: nowMs,
    remark: String(item.remark || "").slice(0, 80),
    billId: discountBill ? discountBill.billId : -1,
  };
  assertTransfer(transfer);
  if (discountBill) await saveBill(discountBill);
  try {
    await saveEntity("transfer", "addOrUpdateTransfer", transfer);
  } catch (e) {
    if (discountBill) { try { await deleteBill(discountBill.billId); } catch { /* ignore */ } }
    throw e;
  }
  invalidate();
  const verified = await softConfirm((s) => (s.Transfer || []).some((t) => Number(t.transferId) === transfer.transferId));
  const effects = aggregate([transferEffects(transfer), discountBill ? billEffect(discountBill) : new Map()]);
  const assets_after = await applyEffects(effects, { verify: true });
  return {
    transfer_id: transfer.transferId,
    from: from.name,
    to: to.name,
    amount,
    to_amount: toAmount,
    discount,
    discount_bill_id: discountBill ? discountBill.billId : -1,
    assets_after,
    verified,
  };
}

export async function refundBill(item = {}) {
  if (item.confirm !== true) throw new ValidationError("退款需要 confirm:true");
  const bill = await findBill(item.bill_id);
  let account;
  if (item.to_account) account = await resolveAccount(item.to_account);
  else account = await resolveAccount(bill.assetId);
  const amount = round2(item.amount);
  if (!(amount > 0)) throw new ValidationError("amount 必须 > 0");
  const timeMs = parseTime(item.time, Date.now());
  const refund = {
    refundId: nextId(),
    userId: Number(CONFIG.userId),
    billId: Number(bill.billId),
    refundNum: amount,
    refundInfos: JSON.stringify([{
      assetId: Number(account.id),
      assetNum: amount,
      costNum: amount,
      number: amount,
      inTime: timeMs,
      time: timeMs,
      notReduceInstalment: true,
      relatedBillId: 0,
      remark: String(item.remark || "").slice(0, 80),
      restoreCostNum: 0,
      restoreNum: 0,
      currentNumber: round2(Number(account.number || 0) + amount),
    }]),
    updateTime: Date.now(),
  };
  assertRefund(refund);
  await saveEntity("refund", "addOrUpdateRefund", refund);
  invalidate();
  const verified = await softConfirm((s) => (s.Refund || []).some((r) => Number(r.refundId) === refund.refundId));
  const assets_after = await applyEffects(refundEffects(refund), { verify: true });
  return { refund_id: refund.refundId, bill_id: Number(bill.billId), amount, account: account.name, assets_after, verified };
}

export async function assetAdjust(item = {}) {
  const acc = await resolveAccount(item.account || item.asset_id);
  let target;
  if (item.amount !== undefined) target = round2(item.amount);
  else if (item.delta !== undefined) target = round2(Number(acc.number || 0) + Number(item.delta));
  else throw new ValidationError("asset_adjust 需要 amount 或 delta");
  const before = round2(acc.number || 0);
  const assets_after = await applyEffects(new Map([[acc.id, round2(target - before)]]), { verify: true });
  return { account: acc.name, before, after: target, assets_after };
}

export async function deleteTransferById(params = {}) {
  if (params.confirm !== true) throw new ValidationError("删除转账需要 confirm:true");
  if (!params.transfer_id) throw new ValidationError("缺少 transfer_id");
  const snap = await snapshot({ force: true });
  const t = (snap.Transfer || []).find((x) => Number(x.transferId) === Number(params.transfer_id));
  if (!t) throw new Error(`转账 ${params.transfer_id} 不存在`);
  let discountBill = null;
  if (Number(t.billId) > 0) discountBill = (snap.Bill || []).find((b) => Number(b.billId) === Number(t.billId)) || null;
  const effects = aggregate([
    negate(transferEffects(t)),
    discountBill ? negate(billEffect(discountBill)) : new Map(),
  ]);
  await saveEntity("transfer", "deleteTransfer", { transferId: Number(t.transferId), userId: Number(CONFIG.userId) });
  if (discountBill) await deleteBill(discountBill.billId);
  invalidate();
  const verified = await softConfirm((s) => !(s.Transfer || []).some((x) => Number(x.transferId) === Number(t.transferId))
    && (!discountBill || !(s.Bill || []).some((b) => Number(b.billId) === Number(discountBill.billId))));
  const assets_after = await applyEffects(effects, { verify: true });
  return { deleted: true, transfer_id: Number(t.transferId), discount_bill_id: discountBill ? Number(discountBill.billId) : -1, assets_after, verified };
}

export async function deleteRefundById(params = {}) {
  if (params.confirm !== true) throw new ValidationError("删除退款需要 confirm:true");
  if (!params.refund_id) throw new ValidationError("缺少 refund_id");
  const snap = await snapshot({ force: true });
  const r = (snap.Refund || []).find((x) => Number(x.refundId) === Number(params.refund_id));
  if (!r) throw new Error(`退款 ${params.refund_id} 不存在`);
  const effects = negate(refundEffects(r));
  await saveEntity("refund", "deleteRefund", { refundId: Number(r.refundId), userId: Number(CONFIG.userId) });
  invalidate();
  const verified = await softConfirm((s) => !(s.Refund || []).some((x) => Number(x.refundId) === Number(r.refundId)));
  const assets_after = await applyEffects(effects, { verify: true });
  return { deleted: true, refund_id: Number(r.refundId), assets_after, verified };
}
