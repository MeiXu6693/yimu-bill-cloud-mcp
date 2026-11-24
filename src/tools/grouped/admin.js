import { z } from "zod";
import { CONFIG } from "../../config.js";
import { invalidate, snapshot } from "../../cache.js";
import { refresh } from "../../taxonomy.js";
import { assetAdjust, deleteRefundById, deleteTransferById, refundBill } from "../../write.js";
import * as client from "../../client.js";
import { accountsView } from "../../view.js";
import { wrap } from "../wrap.js";

const ENTITY = {
  asset: { domain: "asset", cap: "Asset", pk: "assetId" },
  account_book: { domain: "accountBook", cap: "AccountBook", pk: "accountBookId" },
  tag: { domain: "tag", cap: "Tag", pk: "tagId" },
  parent_category: { domain: "parentCategory", cap: "ParentCategory", pk: "categoryId" },
  child_category: { domain: "childCategory", cap: "ChildCategory", pk: "categoryId" },
  lend: { domain: "lend", cap: "Lend", pk: "lendId" },
  reimbursement: { domain: "reimbursement", cap: "Reimbursement", pk: "reimbursementId" },
  bill_file: { domain: "billFile", cap: "BillFile", pk: "fileId" },
  bill_import: { domain: "billImport", cap: "BillImport", pk: "importId" },
  asset_history: { domain: "assetHistory", cap: "AssetHistory", pk: "assetHistoryId" },
};

export function registerAdminTools(server) {
  server.registerTool("admin", {
    description: "低频管理。domain=payment(refund/refund_delete/transfer_delete/asset_adjust)|entity(资产/账本/标签/分类/借贷/报销/附件记录/导入记录/资产变动 save/delete)|system(refresh_cache/token_status/sync_start/sync_end/parse_bill_text)",
    inputSchema: {
      domain: z.enum(["payment", "entity", "system"]),
      action: z.string(),
      type: z.string().optional().describe("entity 类型：asset/account_book/tag/parent_category/child_category/lend/reimbursement/bill_file/bill_import/asset_history"),
      entity: z.record(z.any()).optional(),
      book_id: z.number().optional(),
      section_id: z.string().optional(),
      text: z.string().optional(),
      confirm: z.boolean().optional(),
      params: z.record(z.any()).optional(),
    },
  }, wrap(async (a) => {
    if (a.domain === "payment") {
      if (a.action === "refund") return refundBill({ ...(a.params || {}), confirm: a.confirm });
      if (a.action === "refund_delete") return deleteRefundById({ ...(a.params || {}), confirm: a.confirm });
      if (a.action === "transfer_delete") return deleteTransferById({ ...(a.params || {}), confirm: a.confirm });
      if (a.action === "asset_adjust") {
        const res = await assetAdjust(a.params || {});
        invalidate();
        return res;
      }
      throw new Error(`未知 payment action: ${a.action}`);
    }
    if (a.domain === "entity") {
      const ep = ENTITY[a.type];
      if (!ep) throw new Error(`未知 entity type: ${a.type}`);
      const e = { ...(a.entity || {}) };
      e.userId = e.userId === undefined ? Number(CONFIG.userId) : e.userId;
      if (a.action === "save") {
        e.updateTime = e.updateTime === undefined ? Date.now() : e.updateTime;
        const r = await client.saveEntity(ep.domain, `addOrUpdate${ep.cap}`, e);
        invalidate();
        return { saved: true, type: a.type, result: r };
      }
      if (a.action === "delete") {
        if (a.confirm !== true) throw new Error("删除实体需要 confirm:true");
        if (e[ep.pk] === undefined) throw new Error(`entity.${ep.pk} 必填`);
        const r = await client.saveEntity(ep.domain, `delete${ep.cap}`, e);
        invalidate();
        return { deleted: true, type: a.type, result: r };
      }
      throw new Error(`未知 entity action: ${a.action}`);
    }
    if (a.domain === "system") {
      if (a.action === "refresh_cache") {
        invalidate();
        const t = await refresh({ force: true });
        return { refreshed: true, at: t.at };
      }
      if (a.action === "token_status") return { logged_in: Boolean(CONFIG.token), token_set: Boolean(CONFIG.token), user_id: CONFIG.userId, base_url: "https://yimubill.com/api" };
      if (a.action === "sync_start") return client.syncStart();
      if (a.action === "sync_end") return client.syncEnd(a.params && a.params.sessionId);
      if (a.action === "parse_bill_text") {
        if (!a.text) throw new Error("text 必填");
        return client.parseBillText(a.text);
      }
      if (a.action === "accounts") return accountsView(await snapshot());
      throw new Error(`未知 system action: ${a.action}`);
    }
    throw new Error(`未知 domain: ${a.domain}`);
  }));
}
