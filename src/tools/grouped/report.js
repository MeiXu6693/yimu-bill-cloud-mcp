import { z } from "zod";
import { snapshot } from "../../cache.js";
import { accountsView, budgetView, flowView } from "../../view.js";
import { books, categories, tags } from "../../taxonomy.js";
import { round2 } from "../../validate.js";
import * as client from "../../client.js";
import { wrap } from "../wrap.js";

const TYPES = ["flow", "budget", "holdings", "investment_records", "books", "categories", "tags", "currency", "share_accounts", "account_members", "delete_history", "category_info"];

export function registerReportTools(server) {
  server.registerTool("report", {
    description: "低频查询/目录。type=flow|budget|holdings|investment_records|books|categories|tags|currency|share_accounts|account_members|delete_history|category_info",
    inputSchema: {
      type: z.enum(TYPES),
      month: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      account: z.string().optional(),
      book_id: z.number().optional(),
      time: z.number().optional(),
      limit: z.number().optional(),
    },
  }, wrap(async (a) => {
    switch (a.type) {
      case "flow":
        return flowView(await snapshot(), a);
      case "budget":
        return budgetView(await snapshot(), a);
      case "holdings": {
        const snap = await snapshot();
        const list = (snap.StockAsset || []).filter((s) => !s.hide).map((s) => ({
          name: s.name,
          code: s.code,
          group: s.groupName || "",
          num: Number(s.primeNum || 0),
          cost_basis: round2(Number(s.primeCost || 0) * Number(s.primeNum || 0)),
        }));
        return { valuation: "cost", note: "云端接口无现价/市值，只有成本口径", count: list.length, holdings: list };
      }
      case "investment_records": {
        const snap = await snapshot();
        return { note: "云端只同步到少量理财收益记录，可能不完整", records: (snap.AssetIncome || []).map((x) => ({ id: x.assetIncomeId, name: x.name, code: x.code, asset_id: x.assetId })) };
      }
      case "books":
        return { books: await books(), shared: await client.getShareAccounts() };
      case "categories":
        return categories();
      case "tags":
        return { tags: await tags() };
      case "currency":
        return client.getCurrency();
      case "share_accounts":
        return client.getShareAccounts();
      case "account_members":
        if (!a.book_id) throw new Error("account_members 需要 book_id");
        return client.getAccountMembers(a.book_id);
      case "delete_history":
        return client.getDeleteHistory(a.time || 0);
      case "category_info":
        return client.getCategoriesInfo();
      default:
        throw new Error(`未知 report type: ${a.type}`);
    }
  }));
}
