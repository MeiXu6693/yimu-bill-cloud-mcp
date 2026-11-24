import { z } from "zod";
import { addTransfer } from "../write.js";
import { wrap } from "./wrap.js";

export function registerTransferTools(server) {
  server.registerTool("transfer_add", {
    description: "转账/还款：支持到账金额、手续费、优惠（优惠会自动建关联收入账单）并校正双方余额",
    inputSchema: {
      from: z.string().describe("转出账户名"),
      to: z.string().describe("转入账户名"),
      amount: z.number().describe("实际转出/还款金额"),
      to_amount: z.number().optional().describe("到账金额，缺省=amount+discount"),
      fee: z.number().optional().describe("手续费"),
      discount: z.number().optional().describe("优惠/补贴金额"),
      time: z.string().optional(),
      remark: z.string().optional(),
    },
  }, wrap(async (a) => addTransfer(a)));
}
