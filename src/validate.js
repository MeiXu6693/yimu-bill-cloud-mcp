// 云端 payload 校验：缺字段/类型不对一律拒绝，防止写入“账单页看不见”的 ghost 记录。
export class ValidationError extends Error {}

export function round2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function need(obj, key, label) {
  if (obj[key] === undefined) throw new ValidationError(`${label} 缺少字段 ${key}（完整 payload 才能写入，避免 ghost 记录）`);
}
function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function parseJson(v, label, kind) {
  try {
    const x = typeof v === "string" ? JSON.parse(v) : v;
    if (kind === "array" && !Array.isArray(x)) throw new Error("not array");
    if (kind === "object" && (x === null || typeof x !== "object" || Array.isArray(x))) throw new Error("not object");
    return x;
  } catch {
    throw new ValidationError(`${label} 不是合法 JSON ${kind}`);
  }
}

const BILL_FIELDS = [
  "userId", "bookId", "billId", "assetId", "parentCategoryId", "childCategoryId",
  "cost", "time", "recordTime", "inAssetTime", "billType", "updateTime",
  "tags", "remark", "billShareInfo", "notIntoTotal", "notIntoBudget",
  "reimbursement", "reimbursementEnd", "fromUserId", "discountNumber",
  "currencyInfo", "currencyAssetNumber", "currencyDiscountNumber",
];

export function assertBill(bill) {
  for (const k of BILL_FIELDS) need(bill, k, "bill");
  if (!isNum(Number(bill.billId)) || Number(bill.billId) < 1_0000_0000 || Number(bill.billId) > 2_147_483_646)
    throw new ValidationError("bill.billId 必须是 1e8–2^31-1 的整数（客户端生成）");
  if (!(Number(bill.cost) > 0)) throw new ValidationError("bill.cost 必须 > 0");
  if (!isNum(Number(bill.assetId))) throw new ValidationError("bill.assetId 必须是数字");
  if (!isNum(Number(bill.time)) || Number(bill.time) < 1e12) throw new ValidationError("bill.time 必须是毫秒时间戳");
  if (!isNum(Number(bill.recordTime)) || Number(bill.recordTime) < 1e12) throw new ValidationError("bill.recordTime 必须是毫秒时间戳");
  if (!isNum(Number(bill.updateTime)) || Number(bill.updateTime) < 1e12) throw new ValidationError("bill.updateTime 必须是毫秒时间戳");
  if (Number(bill.inAssetTime) !== 0) throw new ValidationError("bill.inAssetTime 必须为 0");
  parseJson(bill.tags, "bill.tags", "array");
  parseJson(bill.billShareInfo, "bill.billShareInfo", "object");
  if (bill.currencyInfo !== null && bill.currencyInfo !== "") parseJson(bill.currencyInfo, "bill.currencyInfo", "object");
  return bill;
}

export function assertTransfer(t) {
  for (const k of ["transferId", "cost", "toCost", "serviceCharge", "fromAssetId", "toAssetId", "time", "updateTime"]) need(t, k, "transfer");
  if (!isNum(Number(t.transferId)) || Number(t.transferId) < 1_0000_0000 || Number(t.transferId) > 2_147_483_646)
    throw new ValidationError("transfer.transferId 必须是 1e8–2^31-1 的整数");
  if (!(Number(t.cost) >= 0)) throw new ValidationError("transfer.cost 必须 ≥ 0");
  if (!isNum(Number(t.time)) || Number(t.time) < 1e12) throw new ValidationError("transfer.time 必须是毫秒时间戳");
  return t;
}

export function assertRefund(r) {
  for (const k of ["refundId", "billId", "refundNum", "refundInfos", "updateTime"]) need(r, k, "refund");
  if (!(Number(r.refundNum) > 0)) throw new ValidationError("refund.refundNum 必须 > 0");
  const infos = parseJson(r.refundInfos, "refund.refundInfos", "array");
  if (!infos.length) throw new ValidationError("refund.refundInfos 不能为空");
  for (const it of infos) {
    const o = typeof it === "string" ? JSON.parse(it) : it;
    if (!o || o.assetId === undefined || o.assetNum === undefined) throw new ValidationError("refundInfos 每项必须有 assetId/assetNum");
  }
  return r;
}
