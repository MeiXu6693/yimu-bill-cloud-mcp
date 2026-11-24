// 名称 ↔ ID 解析：资产/账本/标签/分类。
// 内置分类来自网页 bundle 提取（data/categories_default.json），自定义分类来自快照合并。
import fs from "node:fs";
import { getAssets } from "./client.js";
import { snapshot } from "./cache.js";
import { CONFIG } from "./config.js";

const DEFAULTS = JSON.parse(
  fs.readFileSync(new URL("./data/categories_default.json", import.meta.url), "utf8"),
);

let state = {
  at: 0,
  assets: new Map(),
  assetList: [],
  parents: new Map(),
  children: new Map(),
  tags: new Map(),
  books: new Map(),
};

function put(map, key, value) {
  if (key !== undefined && key !== null && key !== "") map.set(String(key), value);
}

export async function refresh({ force = false } = {}) {
  if (!force && state.at && Date.now() - state.at < CONFIG.taxonomyTtlMs) return state;
  const [assets, snap] = await Promise.all([getAssets(), snapshot()]);
  const next = {
    at: Date.now(),
    assets: new Map(),
    assetList: assets,
    parents: new Map(),
    children: new Map(),
    tags: new Map(),
    books: new Map(),
  };
  for (const p of DEFAULTS.parents) put(next.parents, p.id, { id: p.id, name: p.name, type: p.id === 9 ? "income" : "expense" });
  for (const c of DEFAULTS.children) put(next.children, c.id, { id: c.id, name: c.name, parentId: c.parent_id, type: c.parent_id === 9 ? "income" : "expense" });
  for (const p of snap.ParentCategory || []) put(next.parents, p.categoryId, { id: Number(p.categoryId), name: p.categoryName, type: p.categoryId === 9 ? "income" : "expense" });
  for (const c of snap.ChildCategory || []) put(next.children, c.categoryId, { id: Number(c.categoryId), name: c.categoryName, parentId: Number(c.parentCategoryId), type: Number(c.parentCategoryId) === 9 ? "income" : "expense" });
  for (const t of snap.Tag || []) put(next.tags, t.tagId, { id: Number(t.tagId), name: t.tagName });
  for (const b of snap.AccountBook || []) put(next.books, b.accountBookId, { id: Number(b.accountBookId), name: b.bookName });
  for (const a of assets) {
    put(next.assets, a.assetId, {
      id: Number(a.assetId),
      name: a.assetName,
      number: Number(a.assetNumber || 0),
      type: Number(a.assetType),
      quota: Number(a.totalQuota || 0),
      group: a.groupName || "",
      raw: a,
    });
  }
  state = next;
  return state;
}

export async function tax() {
  return refresh();
}

function names(map, limit = 12) {
  return [...map.values()].slice(0, limit).map((x) => x.name).join("、");
}

export async function resolveAccount(input) {
  const t = await tax();
  const key = String(input ?? "").trim();
  if (!key) throw new Error("缺少账户名称");
  if (/^\d+$/.test(key)) {
    const a = t.assets.get(key);
    if (a) return a;
    throw new Error(`找不到资产 ID ${key}；可选：${names(t.assets)}`);
  }
  const matches = [...t.assets.values()].filter((a) => a.name === key);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return matches[0];
  const fuzzy = [...t.assets.values()].filter((a) => a.name.includes(key) || key.includes(a.name));
  if (fuzzy.length === 1) return fuzzy[0];
  throw new Error(`找不到账户「${key}」；可选：${names(t.assets)}`);
}

export async function resolveCategory(input) {
  const t = await tax();
  const raw = String(input ?? "").trim();
  if (!raw) throw new Error("缺少分类");
  if (/^\d+$/.test(raw)) {
    const id = Number(raw);
    if (t.parents.has(String(id))) return { parentCategoryId: id, childCategoryId: 0, name: t.parents.get(String(id)).name };
    const c = t.children.get(String(id));
    if (c) return { parentCategoryId: c.parentId, childCategoryId: c.id, name: `${t.parents.get(String(c.parentId))?.name || ""}-${c.name}` };
    throw new Error(`找不到分类 ID ${id}`);
  }
  const dash = raw.indexOf("-");
  if (dash > 0) {
    const pName = raw.slice(0, dash).trim();
    const cName = raw.slice(dash + 1).trim();
    const p = [...t.parents.values()].find((x) => x.name === pName);
    if (!p) throw new Error(`找不到一级分类「${pName}」；可选：${names(t.parents)}`);
    const c = [...t.children.values()].find((x) => x.name === cName && x.parentId === p.id);
    if (!c) throw new Error(`找不到二级分类「${p.name}-${cName}」`);
    return { parentCategoryId: p.id, childCategoryId: c.id, name: `${p.name}-${c.name}` };
  }
  const p = [...t.parents.values()].find((x) => x.name === raw);
  if (p) return { parentCategoryId: p.id, childCategoryId: 0, name: p.name };
  const cs = [...t.children.values()].filter((x) => x.name === raw);
  if (cs.length === 1) {
    const c = cs[0];
    return { parentCategoryId: c.parentId, childCategoryId: c.id, name: `${t.parents.get(String(c.parentId))?.name || ""}-${c.name}` };
  }
  throw new Error(`找不到分类「${raw}」；可选一级：${names(t.parents)}`);
}

export async function resolveTag(input) {
  const t = await tax();
  const key = String(input ?? "").trim();
  if (!key) return null;
  if (/^\d+$/.test(key)) {
    const tag = t.tags.get(key);
    if (tag) return tag;
    throw new Error(`找不到标签 ID ${key}`);
  }
  const found = [...t.tags.values()].find((x) => x.name === key);
  if (found) return found;
  throw new Error(`找不到标签「${key}」；可选：${names(t.tags)}`);
}

export async function resolveBook(input) {
  const t = await tax();
  if (input === undefined || input === null || String(input).trim() === "") {
    const first = [...t.books.values()][0];
    if (!first) throw new Error("云端没有账本");
    return first;
  }
  const key = String(input).trim();
  if (/^\d+$/.test(key)) {
    const b = t.books.get(key);
    if (b) return b;
    throw new Error(`找不到账本 ID ${key}`);
  }
  const found = [...t.books.values()].find((x) => x.name === key);
  if (!found) throw new Error(`找不到账本「${key}」；可选：${names(t.books)}`);
  return found;
}

export async function assetById(id) {
  const t = await tax();
  return t.assets.get(String(id)) || null;
}

export async function assetName(id) {
  const a = await assetById(id);
  return a ? a.name : `资产${id}`;
}

export async function categoryInfo(parentId, childId) {
  const t = await tax();
  const p = t.parents.get(String(parentId));
  const c = childId ? t.children.get(String(childId)) : null;
  return { parentName: p ? p.name : `分类${parentId}`, childName: c ? c.name : "" };
}

export async function tagNames(ids) {
  const t = await tax();
  return (ids || []).map((id) => t.tags.get(String(id))?.name).filter(Boolean);
}

export async function books() {
  const t = await tax();
  return [...t.books.values()];
}

export async function categories() {
  const t = await tax();
  return {
    parents: [...t.parents.values()].map((p) => ({ id: p.id, name: p.name, type: p.type, children: [...t.children.values()].filter((c) => c.parentId === p.id).map((c) => ({ id: c.id, name: c.name })) })),
  };
}

export async function tags() {
  const t = await tax();
  return [...t.tags.values()];
}
