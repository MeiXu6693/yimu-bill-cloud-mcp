// 余额引擎：云端网页 API 的账单/转账/退款写入不会自动维护资产余额，这里统一算 Δ 并回写 save_asset。
import { getAssets, saveEntity } from "./client.js";
import { round2 } from "./validate.js";

export function isIncomeBill(bill) {
  return Number(bill.parentCategoryId) === 9;
}

export function billEffect(bill) {
  const delta = isIncomeBill(bill) ? Number(bill.cost) : -Number(bill.cost);
  return new Map([[Number(bill.assetId), round2(delta)]]);
}

export function transferEffects(t) {
  // 实测 App 语义：转出方按 cost 扣款；serviceCharge 只是展示/元数据。
  // 优惠（负 serviceCharge）用一笔关联的收入账单把钱加回转出方；
  // 正数 serviceCharge（手续费）视为额外扣款（App 数据里暂未出现，按此保守处理）。
  const cost = Number(t.cost);
  const fee = Math.max(Number(t.serviceCharge || 0), 0);
  const to = Number(t.toCost) || cost;
  return new Map([
    [Number(t.fromAssetId), round2(-(cost + fee))],
    [Number(t.toAssetId), round2(to)],
  ]);
}

export function refundEffects(refund) {
  const out = new Map();
  const infos = typeof refund.refundInfos === "string" ? JSON.parse(refund.refundInfos) : refund.refundInfos;
  for (const raw of infos || []) {
    const it = typeof raw === "string" ? JSON.parse(raw) : raw;
    const key = Number(it.assetId);
    out.set(key, round2((out.get(key) || 0) + Number(it.assetNum || 0)));
  }
  return out;
}

export function aggregate(effectsList) {
  const out = new Map();
  for (const effects of effectsList) {
    for (const [id, delta] of effects || []) out.set(Number(id), round2((out.get(Number(id)) || 0) + Number(delta)));
  }
  return out;
}

export function negate(effects) {
  const out = new Map();
  for (const [id, delta] of effects || []) out.set(Number(id), round2(-Number(delta)));
  return out;
}

export async function applyEffects(effects, { verify = true, note = "" } = {}) {
  const assets = await getAssets();
  const byId = new Map(assets.map((a) => [Number(a.assetId), a]));
  const after = {};
  for (const [id, delta] of effects) {
    const assetId = Number(id);
    if (!delta) continue;
    const a = byId.get(assetId);
    if (!a) throw new Error(`资产 ${assetId} 不存在，无法校正余额`);
    const newNum = round2(Number(a.assetNumber || 0) + Number(delta));
    const entity = { ...a, assetNumber: newNum, updateTime: Date.now() };
    await saveEntity("asset", "addOrUpdateAsset", entity);
    after[a.assetName] = newNum;
  }
  if (verify && Object.keys(after).length) {
    const again = await getAssets();
    const map = new Map(again.map((a) => [a.assetName, Number(a.assetNumber || 0)]));
    for (const [name, value] of Object.entries(after)) {
      if (Math.abs(Number(map.get(name) || 0) - Number(value)) > 0.005) {
        throw new Error(`余额校正校验失败：${name} 期望 ${value}，云端为 ${map.get(name)}`);
      }
    }
  }
  return after;
}
