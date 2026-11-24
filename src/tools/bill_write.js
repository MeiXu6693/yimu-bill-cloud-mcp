import { z } from "zod";
import { createBills, deleteBillById, updateBill } from "../write.js";
import { wrap } from "./wrap.js";

const billFields = {
  account: z.string().describe("账户名称"),
  category: z.string().describe("分类名，支持「一级-二级」"),
  sub_category: z.string().optional(),
  amount: z.number().describe("实付金额（优惠后）"),
  discount: z.number().optional().describe("优惠金额，原价=amount+discount"),
  time: z.string().optional().describe("yyyy-MM-dd HH:mm，默认现在"),
  remark: z.string().optional(),
  tags: z.array(z.string()).optional().describe("标签名或 ID"),
  not_into_total: z.boolean().optional(),
  not_into_budget: z.boolean().optional(),
  reimbursement: z.boolean().optional(),
  book: z.string().optional(),
  currency: z.record(z.any()).optional(),
  bill_id: z.number().optional().describe("调用方生成，用于幂等"),
};

export function registerBillTools(server) {
  server.registerTool("bill_add", {
    description: "语义记一笔：账户/分类用名称，优惠写 discount；内部构造完整 payload 并自动校正余额",
    inputSchema: billFields,
  }, wrap(async (a) => {
    const res = await createBills([a]);
    return { ...(res.created[0] || {}), skipped_existing: res.skipped_existing, assets_after: res.assets_after, verified: res.verified };
  }));

  server.registerTool("bills_add", {
    description: "批量记多笔（≤100）语义账单；同秒同额多笔也会逐笔创建，不合并",
    inputSchema: { bills: z.array(z.object(billFields)).min(1).max(100) },
  }, wrap(async (a) => createBills(a.bills)));

  server.registerTool("bill_update", {
    description: "改一笔账单（金额/优惠/账户/分类/时间/备注/标签/非收支），按新旧差额校正余额",
    inputSchema: {
      bill_id: z.number(),
      amount: z.number().optional(),
      discount: z.number().optional(),
      account: z.string().optional(),
      category: z.string().optional(),
      sub_category: z.string().optional(),
      time: z.string().optional(),
      remark: z.string().optional(),
      tags: z.array(z.string()).optional(),
      clear_tags: z.boolean().optional(),
      not_into_total: z.boolean().optional(),
      not_into_budget: z.boolean().optional(),
      reimbursement: z.boolean().optional(),
    },
  }, wrap(async (a) => updateBill(a)));

  server.registerTool("bill_delete", {
    description: "删除账单并反向校正余额（必须 confirm:true）",
    inputSchema: { bill_id: z.number(), confirm: z.boolean().describe("必须 true") },
  }, wrap(async (a) => deleteBillById(a)));
}
