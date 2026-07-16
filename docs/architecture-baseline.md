# OpenX 架构基线（当前事实）

> 本文描述**当前已实现**的架构与产品边界。路线图/未来能力见其它文档，勿与基线混写。

更新日期：2026-07-12

## 产品定位

OpenX 是 **Foreman（包工头）系统**：分解用户意图、注入约束与上下文、向外部 CLI Agent（施工队）派单、监控执行、验收结果并触发返工。不自建通用 coding agent 运行时。

## 三层边界

| 层 | 位置 | 职责 |
|----|------|------|
| 用户层 | `apps/web` | 目标、对话、验收、工具页 |
| 工头层 | `apps/server` | Goal 生命周期、编排、SSE、Coach |
| 执行层 | `packages/executor-*` | Pi / ACP / Connect / Mock 适配器 |

## Goal 状态机（七态）

`draft → running → paused → running → awaiting_review → done | failed | cancelled`

- 正式 **`paused`**：等待开发商决策（工头 park）；续跑须显式 TaskCommand `resume` /「回复并继续」。
- `rework` 是 **effect**（`effectStatus`），不是独立状态。
- 完成协议：执行器须显式报告成功/失败；`markGoalComplete` 拒绝空摘要与自述未完成的交差；`orchestrator` 仅在完成成功后自动验收。
- 结构化结果类型：`ExecutionOutcome`（`completed | blocked | failed`）。

## 派单权限（硬约束）

`dispatchContext.permissionMode`：

| 模式 | 运行时行为 |
|------|------------|
| `read_only` | Pi 仅注册只读工具；ACP 拒绝写权限请求 |
| `ask_write` | 初始只读；开发商确认续跑后可提升为 `full` 并激活写工具 |
| `full` / 缺省 | 完整编码工具 |
| `unattended` | 等同 full，ACP 跳过权限确认（Tools 可开「默认无人值守」） |

可选 `allowedTools` / `maxToolCalls` / `runBudgetTokens` 与权限基线取交集。

提示词块仍注入，但**不再是唯一安全机制**。

## 派单可观测性

- **`dispatch_receipts`**：`dispatchGoal` 成功时写入 `receiptId` + `runId` + `dispatchContext` 快照；Connect 心跳 `pendingGoals` 绑定 `{ goal, receiptId, runId }`；`POST /internal/dispatch-receipts/ack` 确认收单。
- **`token_usage_events`**：Connect 心跳 `tokenUsage` 落库；`GET /api/system/stats/tokens?goalId=` 聚合查询。

## ACP 续跑

- `loadSession` 后注入 OpenX 压缩 transcript（crew exchanges + summaries + logs），见 `buildResumeTranscriptBlock`。
- ACP 协议层仍用 `prompt` 表达 steer 语义；Pi 优先 parked child + `session.steer`。

## 运行模式（信任边界）

| 模式 | 条件 | 约束 |
|------|------|------|
| `desktop-local` | 默认 / `OPENX_RUNTIME_MODE=desktop-local` | 强制 loopback 绑定 |
| `remote` | 非 loopback HOST 或显式 remote | 启动前必须 `OPENX_API_TOKEN`；`/api/*` 需 Bearer |

数据根目录：`OPENX_HOME`（测试隔离）> `OPENX_CONFIG_PATH` 父目录 > `~/.openx`。

## 集成插件

`IntegrationPlugin`（`apps/server/src/integration-plugin.ts`）用于可选集成：

- `getManifest()` 声明版本、能力、OXSP 模板、Tools Tab
- `GET /api/integrations` 返回已安装/启用/健康状态；启动失败标记 `degraded`，不阻断核心
- **Miloco** 为第一个实现：默认 **关闭**；旧配置自动迁移启用一次；`OPENX_MILOCO` 环境变量始终覆盖 Settings
- Layer B 诊断为后台缓存任务；Webhook 默认 `202 + runId`；感知事件走 `integration_runs`（仅危险操作升级 Goal）
- `PATCH /api/integrations/:id` 支持运行时启停；禁用返回 `409 integration_disabled`
- Web「拓展中心」目录 + SSE `integration.updated` / `integration.run.updated`

## 数据正确性（Goal CAS）

- `Goal.revision` + `casUpdateGoal` / `transitionGoalStatus` / `claimConnectPoolGoal`
- 生命周期完成/失败/取消与 log / summary / SSE outbox 走 `runGoalDbTransaction`
- `PATCH /api/goals/:id` 支持可选 `baseRevision`，冲突返回 409

## Pi worker park / resume

- 子进程保活：`park` IPC 后 child 留在 `parkedChildren`；`resumePiChild` 续跑同 session
- Orchestrator 优先走 parked child，否则 in-process `steerRework`
- Integration `ask_write` 强制 `full`（无用户续跑通道，避免悬挂）

## Miloco 启停

- 默认关闭；`OPENX_MILOCO=0/1` 强制覆盖；遗留 artifact 一次性迁移
- Watchdog env（`OPENX_MILOCO_*_WATCH`）**不再**隐式启用集成

## DB 领域拆分（起步）

| 模块 | 内容 |
|------|------|
| `db/connection.ts` | `getDb` / migrate / `ensureColumn` |
| `db/goals-repo.ts` | list/insert/`casUpdateGoal`/CAS/delete/logs |
| `db/sse-repo.ts` | append/prune/list |
| `db/dispatch-receipts-repo.ts` | 派单凭证 |
| `db/token-usage-repo.ts` | Connect token 用量 |
| `db.ts` | 薄 re-export + coach/projects/memory 等 |

## 已知债务（稳定化 backlog）

1. ~~Goal `revision` CAS 与统一事务~~（已完成）
2. ~~`db.ts` 按领域起步拆分~~（goals/sse/connection 已抽出；coach/projects/memory 待下波）
3. 大型前端模块（`ChatPanel` / `api.ts` / `app-state`）按领域拆分
4. API 客户端与 catalog 从路由契约生成
5. ~~派单权限对 Pi worker 子进程的 park/elevate 完整透传~~（已完成；crew 问答 IPC 可第二迭代）
