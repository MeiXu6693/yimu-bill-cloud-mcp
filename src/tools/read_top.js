import { z } from "zod";
import { snapshot } from "../cache.js";
import { accountsView, overviewView, queryBills, statsView } from "../view.js";
import { wrap } from "./wrap.js";

export function registerReadTools(server) {
  server.registerTool("overview", {
    description: "今日/本月收支、结余、预算摘要（口径：排除不计收支/报销中账单）",
    inputSchema: { month: z.string().optional().describe("yyyy-MM，默认本月"), book: z.string().optional() },
  }, wrap(async (a) => overviewView(await snapshot(), a)));

  server.registerTool("query_bills", {
    description: "按日期/账户/分类/类型/标签/关键词/金额筛选账单（含优惠、非收支、报销字段）",
    inputSchema: {
      from: z.string().optional().describe("yyyy-MM-dd"),
      to: z.string().optional().describe("yyyy-MM-dd"),
      month: z.string().optional().describe("yyyy-MM"),
      account: z.string().optional().describe("账户名称或 assetId"),
      category: z.string().optional().describe("分类名或 ID，支持「一级-二级」"),
      sub_category: z.string().optional(),
      type: z.enum(["expense", "income"]).optional(),
      tag: z.string().optional(),
      keyword: z.string().optional(),
      min_amount: z.number().optional(),
      max_amount: z.number().optional(),
      include_excluded: z.boolean().optional().describe("true=包含不计收支与报销中账单"),
      limit: z.number().optional().describe("默认 50，最大 200"),
      offset: z.number().optional(),
    },
  }, wrap(async (a) => queryBills(await snapshot(), a)));

  server.registerTool("stats", {
    description: "统计：按分类/天/月/标签汇总金额、笔数、占比（口径同 overview）",
    inputSchema: {
      by: z.enum(["category", "sub_category", "day", "month", "tag"]).describe("分组维度"),
      type: z.enum(["expense", "income", "all"]).optional().describe("默认 expense"),
      month: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      include_excluded: z.boolean().optional(),
    },
  }, wrap(async (a) => statsView(await snapshot(), a)));

  server.registerTool("accounts", {
    description: "账户视图：资金/信贷/债务/报销（额度、可用、账单日、还款日）+ 理财成本口径",
    inputSchema: {},
  }, wrap(async () => accountsView(await snapshot())));
}
