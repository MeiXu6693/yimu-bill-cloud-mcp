# yimu-bill-cloud-mcp

一木记账（yimubill.com）云端 MCP：把网页版 API 封装成 **11 个语义化工具**，供 AI Agent 记账、查询与对账。

> Fork 自 [`@powercess/yimu-mcp`](https://github.com/powercess/yimu-mcp) v0.2.0（MIT），
> 复用了 `vendor/api.js`、`vendor/crypto.js`，在其上补齐语义化写入、自动余额、App 对等查询与重试。见 `NOTICE`。
>
> 非官方项目，与一木记账官方无关联；接口来自其公开网页端，升级或调整后可能失效。
>
> 这是 MCP 协议层；DSH 宿主侧的扫码登录插件见 [`MeiXu6693/dsh-yimu-bill`](https://github.com/MeiXu6693/dsh-yimu-bill)。

## 特性

- **语义化写入**：`bill_add` / `bills_add` / `bill_update` / `bill_delete` / `transfer_add` 只传业务参数（账户名、分类名、金额、优惠…），payload 构造、字段校验、账户/分类解析都在服务端完成。
- **自动余额**：网页 API 的增删改不维护资产余额；MCP 统一计算 Δ、写 `save_asset`、回读校验（容差 0.005）。
- **App 对等查询**：`overview` / `query_bills` / `stats` / `accounts` / `report`（流水、预算、持仓、目录），统计口径排除「不计收支」与「报销中」。
- **瞬时失败自动重试**：网络/超时/5xx 自动重试 3 次；写请求额外重试 `code=1`；耗尽后只返回「云端暂时不可用」。
- **可测试**：`npm test` 用本地 mock API，不连真实账号。

## 快速开始

要求 Node.js >= 22。

```bash
git clone https://github.com/MeiXu6693/yimu-bill-cloud-mcp.git
cd yimu-bill-cloud-mcp
npm install
npm test          # 17 个用例（含离线工具清单）

YIMU_TOKEN='<网页版 JWT>' YIMU_USER_ID='<用户ID>' node src/index.js
```

命令行参数：

| 参数 | 作用 |
|---|---|
| `--list-tools` | 离线输出 11 个工具及其 JSON Schema（JSON），不需要 token；供安装检查、CI 与 DSH 兼容层使用 |
| `--version` | 打印版本后退出 |

- `YIMU_TOKEN`：一木记账网页版登录后的 JWT（浏览器开发者工具里取），**不要提交到仓库**。
- `YIMU_USER_ID`：可省略，会从 JWT 的 `aud` 推断。
- 测试专用：`YIMU_MOCK_BASE` 可把官方域名重写到本地 mock。

### 作为 MCP 服务注册（Claude Desktop、其他 MCP 客户端）

```json
{
  "mcpServers": {
    "yimu_cloud": {
      "command": "node",
      "args": ["<path-to-repo>/src/index.js"],
      "cwd": "<path-to-repo>",
      "env": { "YIMU_TOKEN": "<网页版 JWT>" }
    }
  }
}
```

### DSH 宿主

DSH 侧不使用 `@deepseek-ai/dsh-mcp-client`，也不走 `mcpManager`：由
[`dsh-yimu-bill`](https://github.com/MeiXu6693/dsh-yimu-bill) 插件作为**私有 MCP 宿主**
（兼容层）在「记账模式」的会话作用域内拉起本服务，并把工具映射成原生 DSH 工具。
插件设置页负责扫码登录与凭据写入，token 只出现在子进程环境变量里。

## 工具（11 个）

### 一级（高频）

| 工具 | 作用 |
|---|---|
| `overview` | 今日/本月收支、结余、预算摘要 |
| `query_bills` | 账单筛选/分页（日期/账户/分类/类型/标签/关键词/金额） |
| `stats` | 分类/天/月/标签统计（金额、笔数、占比） |
| `accounts` | 资金/信贷/债务/报销账户 + 理财成本口径 |
| `bill_add` | 语义记一笔（名称→ID、优惠、标签、非收支、报销），自动校正余额 |
| `bills_add` | 批量 ≤100 笔；同秒同额多笔逐笔创建，不合并 |
| `bill_update` | 改单（金额/优惠/账户/分类/时间/备注/标签），按差额校正余额 |
| `bill_delete` | 删单并反向校正余额（须 `confirm:true`） |
| `transfer_add` | 转账/还款；有优惠自动建关联收入账单，校正双方余额 |

### 分组（低频）

| 工具 | 路由 |
|---|---|
| `report` | `flow` / `budget` / `holdings` / `investment_records` / `books` / `categories` / `tags` / `currency` / `share_accounts` / `account_members` / `delete_history` / `category_info` |
| `admin` | `payment`（`refund` / `refund_delete` / `transfer_delete` / `asset_adjust`）、`entity`（资产/账本/标签/分类/借贷/报销/附件记录/导入记录/资产变动 save/delete）、`system`（`refresh_cache` / `token_status` / `sync_start` / `sync_end` / `parse_bill_text`） |

## 关键语义

- **统计口径**：默认排除「不计入收支」（`notIntoTotal`）和「报销中」（`reimbursement && !reimbursementEnd`）；`include_excluded:true` 放开。`stats` 默认只算支出（`type` 可 income/all）。
- **余额**：支出 `-cost`、收入 `+cost`；转账转出 `-cost`、转入 `+toCost`，`serviceCharge` 是优惠/手续费展示字段，优惠会另建关联收入账单（`billId` 指向它）；退款 `+refundNum`；删除取反；改单按新旧差额。
- **完整校验**：账单必须包含 `billId/inAssetTime/updateTime/billShareInfo/discountNumber` 等字段，缺字段直接拒绝（防“账单页看不见”的 ghost 记录）。
- **幂等**：账单可显式传 `bill_id`（1e8–2^31-1），已存在则跳过。
- **分类**：内置分类 id↔名称随包发布（`src/data/categories_default.json`），与云端自定义分类合并；支持 `"食品餐饮"`、`"食品餐饮-午餐"`、数字 ID。
- **缓存**：全量快照 TTL 5s、taxonomy 10 分钟；写后失效并轮询确认。

## 瞬时失败自动重试

网络错误/超时/HTTP 5xx 自动重试（默认 3 次、退避 300ms）；写请求额外重试服务端 `code=1`。
重试耗尽后返回「云端暂时不可用（已自动重试 N 次）」，不暴露底层 code/堆栈。
调试时 `YIMU_DEBUG=1` 可把重试细节写 stderr；`YIMU_RETRY_ATTEMPTS` / `YIMU_RETRY_DELAY_MS` 可调。

## 明确不支持

- 预算写入（App 也无对应 API；预算用量可算）
- 理财现价/市值/盈亏（云端无行情接口，`holdings` 只有成本口径）
- 附件文件上传（STS 未开放）、分期、账单拆分
- 账号管理（登录方式、改密、注销等）

## 目录

```
src/index.js          stdio 入口
src/server.js         注册 11 个工具
src/config.js         env 配置（token/userId）
src/client.js         官方 API 薄封装 + 瞬时失败重试
src/taxonomy.js       名称↔ID、内置分类默认表
src/cache.js          快照缓存/失效
src/view.js           查询/统计/概览/账户/流水/预算视图
src/write.js          语义写入（账单/转账/退款/余额）
src/validate.js       payload 校验
src/balance.js        Δ 引擎
src/tools/            一级工具（read_top/bill_write/transfer）与 grouped（report/admin）
vendor/               上游 MIT 代码 + LICENSE
test/                 mock API + 用例
```

## 安全

- `YIMU_TOKEN` 只放环境变量或本地配置，不进仓库；泄露后请重新登录网页版使其失效。
- 本仓库不含任何真实 token；测试全部走 mock。

## 免责声明

非官方项目，与一木记账官方无关联。`vendor/` 下的 API 客户端来自社区项目
[`@powercess/yimu-mcp`](https://github.com/powercess/yimu-mcp)，接口若变更可能随时失效；
写入类工具会真实改动账本，请自行备份并在小范围试跑后再全量使用。

## 致谢与授权

- 上游：[`@powercess/yimu-mcp`](https://github.com/powercess/yimu-mcp) v0.2.0，MIT，
  Copyright (c) 2026 powercess。
- 本仓库复用的上游代码保存在 `vendor/`，其许可证原文见 `vendor/LICENSE`，来源与改动说明见 `NOTICE`；
  上游版权声明与许可声明随源码一并分发。
- 本 fork 新增与修改的代码同样以 MIT 发布，见 `LICENSE`。

