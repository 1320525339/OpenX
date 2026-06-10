# OpenX 正式版 · 产品核心架构

> 工头层（Orchestrator）：指挥外部 CLI Agent、汇总状态、分解目标、记忆反馈并优化。不自造 LLM 运行时与 Coding Agent。

## 1. 三条核心需求

| # | 需求 | 正式版落点 |
|---|------|------------|
| 1 | 指挥其他 Agent 开发任务，并根据其反馈更新任务状态 | Goal 五态机 + Executor 适配器 + SSE 看板 + `/internal/*` 回调 |
| 2 | 分解用户需求，记忆各 Agent 反馈并持续优化 | Coach refine/chat + `coach_messages` + `execution_summaries` + 返工自动优化提示词 |
| 3 | 不从头造轮子，复用成熟项目与通用协议 | Vercel AI SDK、Pi SDK（内嵌底座）、Mission Control 式 Connect/Heartbeat（子集） |

## 2. 三层架构

```text
用户层 (apps/web)
  定目标 · 看状态 · 确认效果 · Coach 对话

工头层 (apps/server + packages/coach)          ← OpenX 核心
  Goal 分解/记忆/优化 · 指派 · 状态汇总 · 播报

执行层 (packages/executor-pi)                  ← **Pi SDK 内嵌为底座**，不依赖外部 CLI
  pi（本机唯一执行器）· 未来 ACP / connect 外部 Agent
```

## 3. Pi 为内嵌执行底座

| 项 | 说明 |
|----|------|
| 集成 | `@earendil-works/pi-coding-agent` 进程内 `AgentSession`（见 `vendors/pi/.../docs/rpc.md` SDK 建议） |
| 默认 | 新目标默认 `executorId: pi` |
| 工作目录 | `settings.workspaceRoot` → Pi `cwd` |
| 返工 | `buildExecutionPrompt` + Coach 优化后再 `session.prompt()` |
| 取消 | `session.abort()` |
| 配置 | `settings.model.pi` 引用 providers 池；超时见 `executors.pi`；Pi 鉴权仍可用 `~/.pi/agent` |

用户无需单独安装 Pi CLI；OpenX 自带 Pi 运行时。Mock 仅用于无模型凭据时的演示。

## 3.1 LLM 模型 JSON 配置（`~/.openx/config.json`）

Coach、Pi 与未来 Agent **共用** `providers` 渠道池；各角色通过 `model` 字段引用 `slug/modelId`：

```json
{
  "model": {
    "coach": "zen/big-pickle",
    "pi": "zen/big-pickle",
    "default": "zen/big-pickle"
  },
  "providers": {
    "zen": {
      "name": "OpenCode Zen",
      "api": { "type": "openai-compatible", "baseUrl": "https://opencode.ai/zen/v1" },
      "auth": { "apiKey": "public" },
      "models": { "big-pickle": { "name": "Big Pickle" } },
      "source": { "template": "opencode-zen" }
    }
  }
}
```

- **新增渠道**：网页选模板 → 填 slug → 写入 `providers.{slug}`
- **删除渠道**：从 JSON 移除该 key；若 `model.coach`/`model.pi` 指向被删 slug 则自动回退
- **内置模板**：代码内 `LLM_PROVIDER_TEMPLATES`，不落盘直到用户保存
- **旧版 `coach` 字段**：加载时自动迁移为 `model` + `providers`，保存时不再写入

## 4. 执行协议（ExecutorAdapter）

```text
run({ goal, workspaceRoot, settings, callbacks, priorLogs?, isRework? })
  → onProgress / onLog / onComplete / onFail
```

- 返工时 `buildExecutionPrompt()` 注入 `reworkReason`、上轮摘要、近期日志
- 新 CLI = 新 Adapter，不改 Server 主流程

## 4. 外部 Agent 接入（Connect 子集）

借 `vendors/mission-control/docs/cli-integration.md`：

```text
POST /api/connect        → connection_id + 回调 URL
POST /api/connect/:id/heartbeat → 待办 running goals + 保活
POST /internal/goals/:id/*      → 进度/日志/完成/失败（本机鉴权）
GET  /api/events                → SSE 推送
```

## 5. 记忆模型（SQLite）

| 表 | 用途 |
|----|------|
| `goals` | 目标主表（含 rework_reason） |
| `goal_logs` | 执行轨迹 |
| `coach_messages` | Coach 对话持久化 |
| `execution_summaries` | 每轮执行结果摘要，供返工优化 |

## 6. 正式版 MVP 验收

- [x] 创建目标 → Coach 分解 → Pi 执行 → awaiting_review → 达标/返工
- [x] 返工时自动读反馈优化 `executionPrompt` 再 dispatch
- [x] Coach 对话刷新不丢失（按 goal 可选过滤）
- [x] Connect + Heartbeat 可发现待办任务
- [x] `/internal/*` 本机鉴权
- [ ] 第二 Executor（OpenCode/ACP）— 下一阶段
- [ ] 跨 Goal 经验统计 optimize — 下一阶段

## 7. 参考 vendors（只读）

- `vendors/mission-control` — Connect、Heartbeat、optimize
- `vendors/pi` — SDK / RPC 协议参考
- `vendors/opencode` — LLM 栈与 Zen 预设
