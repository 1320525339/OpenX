# 对话流升级计划:执行过程可视化 + 流式输出

> 目标:让对话/任务界面完整呈现 Pi 底座与 ACP CLI 的执行过程(工具调用、命令、思考、文本增量),并让 Coach 聊天支持流式显示。
> 范围:`packages/shared` / `packages/coach` / `packages/executor-*` / `apps/server` / `apps/web`。
>
> **进度:P0 已完成(2026-06-11)。本版补充案例研究与 P1/P2 代码级修改方式。**

---

## 一、现状审查结论

### 1. 后端事件管线(已就绪)

```
Pi SDK / ACP CLI ──► executor 适配器 ──► RunDeltaEvent ──► SSE run.* ──► 前端 state.runs
                                         (text.delta / tool.start / tool.end / status)
```

- Pi(`packages/executor-pi/src/index.ts` `handlePiEvent`):已映射 `text_delta`、`tool_execution_start/end`、`agent_start`、`turn_end`。
- ACP(`packages/executor-acp/src/session-updates.ts`):已映射 `agent_message_chunk`、`agent_thought_chunk`(→ `status` "思考 ›")、`tool_call`、`tool_call_update`。
- 服务端(`apps/server/src/run-service.ts`):run 事件持久化到 `run_events` 表(每 goal 上限 400 条),SSE 广播 `run.started / run.event / run.ended`。
- 前端(`apps/web/src/lib/app-state.tsx` + `run-state.ts`):SSE 已订阅,`state.runs` 正确累积 `liveText` 与事件。

### 2. P0 已完成项

| 项 | 文件 |
|----|------|
| 任务详情挂载 RunConsole | `TaskDetailPanel.tsx` / `GoalDetailPage.tsx` / `App.tsx` |
| 历史 run 回填(getGoalRun) | `app-state.tsx`(选中/详情/进对话三处触发,hydratedRunIdsRef 去重) |
| 对话流内嵌执行卡片 | `ChatExecutionCard.tsx`(新) + `lib/chat-execution.ts`(新) + `ChatPanel.tsx` |
| RunConsole compact 模式 | `RunConsole.tsx` + `panels.css` |
| narration.append → 播报 | `app-state.tsx` → BroadcastTicker |

### 3. 剩余事件丢失点

| 来源 | 被丢弃的事件 | 影响 |
|------|-------------|------|
| Pi | `thinking_start/delta/end` | 思考过程完全不可见 |
| Pi | `tool_execution_update.partialResult` | 工具运行中输出只进 debug log,不进 run 流 |
| Pi | `toolCallId` / `args` / `result` 详情 | 工具行只有名字,无参数与结果摘要;同名工具无法配对 |
| ACP | `plan`、tool 中间态、非 text chunk | 计划/diff 内容不可见 |
| Coach | 全程 `generateObject` 一次性返回 | 无流式、无打字机 |

---

## 二、案例研究(SDK 类型与项目内范例,均已核实)

### 案例 1:Pi SDK 事件全集(`@earendil-works/pi-agent-core` 0.78.1 `types.d.ts`)

```typescript
// AgentEvent —— 工具执行三件套,字段比 OpenX 当前使用的丰富得多
{ type: "tool_execution_start";  toolCallId: string; toolName: string; args: any }
{ type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
{ type: "tool_execution_end";    toolCallId: string; toolName: string; result: any; isError: boolean }
```

```typescript
// AssistantMessageEvent(@earendil-works/pi-ai types.d.ts L257+)—— 思考流确实存在
{ type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
{ type: "text_delta";     contentIndex: number; delta: string; partial: AssistantMessage }
{ type: "toolcall_start" | "toolcall_delta" | "toolcall_end"; ... }
```

`docs/sdk.md` Events 节(L266-328)官方推荐订阅写法即 switch 全事件类型,OpenX 只差「补分支」。

**结论:P1 不需要任何 hack,SDK 原生提供 `thinking_delta`、`toolCallId`、`partialResult`、`result`。**

### 案例 2:项目内 `streamText` 范例(`packages/connect-client/src/llm.ts` L40-53)

```typescript
const result = streamText({ model: provider(creds.model), system, prompt, temperature: 0.2 });
for await (const delta of result.textStream) {
  summary += delta;
  if (onTextDelta) await onTextDelta(delta);
}
```

**结论:Coach 流式聊天(P2)可以直接复制这个消费模式,技术栈零新增。**

### 案例 3:ACP 思考折叠的局限(`session-updates.ts` L34-40)

ACP 把 `agent_thought_chunk` 折叠成 `status: "思考 › 前160字"`——每个 chunk 一条独立 status,思考长时会刷屏且不连贯。P1 应升级为 `thinking.delta` 增量累积,UI 渲染为单个折叠区。

### 案例 4:RunConsole 工具配对隐患(`RunConsole.tsx` toolRows)

当前用 **工具名** 匹配 start/end:同名工具并发(Pi 常并行 read)时会配错。SDK 提供 `toolCallId`,P1 改用 id 配对。

---

## 三、P1 修改计划:丰富事件类型(代码级)

### P1-1 `packages/shared/src/run.ts`

```typescript
// RunDeltaEventSchema / RunStreamEventSchema 各新增两个分支:
z.object({
  type: z.literal("thinking.delta"),
  delta: z.string(),
  timestamp: z.string(),
}),
z.object({
  type: z.literal("tool.update"),
  tool: z.string(),
  toolCallId: z.string().optional(),
  outputPreview: z.string().optional(),   // 工具运行中输出尾部 ≤200 字
  timestamp: z.string(),
}),
// tool.start 增加: toolCallId: z.string().optional()
// tool.end   增加: toolCallId: z.string().optional(), resultPreview: z.string().optional()
```

`GoalRunState` 增加 `thinkingText: string`(累积,上限 4000 字符);`applyRunStreamEvent` 加 `thinking.delta` 累积分支;`createEmptyRunState` 初始化空串。

> 兼容性:`run_events` 表存 JSON,新分支不影响旧数据重放;旧前端遇到未知 type 走 zod 校验失败前的 SSE 原始分发——前端 `handleRunEvent` 直接消费 payload,未知类型在 `applyRunStreamEvent` 中无分支即忽略,安全。

### P1-2 `packages/executor-core/src/run-events.ts`

```typescript
export class RunEventEmitter {
  private thinkingBuffer = "";
  private toolUpdateAt = new Map<string, number>();   // toolCallId → last emit ms

  async thinkingDelta(delta: string) {
    this.thinkingBuffer += delta;
    if (this.thinkingBuffer.length >= 64) await this.flushThinking();
  }
  async flushThinking() { /* 同 flushText 模式 */ }

  async toolStart(tool: string, argsPreview?: string, toolCallId?: string) { ... }
  async toolUpdate(tool: string, toolCallId: string | undefined, outputPreview: string) {
    // 节流:同一 toolCallId ≥500ms 才发一条;发送前 flushText/flushThinking
  }
  async toolEnd(tool: string, isError?: boolean, toolCallId?: string, resultPreview?: string) { ... }

  async finish() { await this.flushText(); await this.flushThinking(); }
}
```

### P1-3 `packages/executor-pi/src/index.ts` `handlePiEvent`

```typescript
if (evt.type === "message_update") {
  const inner = evt.assistantMessageEvent;
  if (inner.type === "text_delta" && typeof inner.delta === "string") { /* 现有逻辑 */ }
  if (inner.type === "thinking_delta" && typeof inner.delta === "string") {
    await run?.thinkingDelta(inner.delta);            // 新增
  }
  if (inner.type === "error") { /* 现有逻辑 */ }
}

if (evt.type === "tool_execution_start") {
  await run?.toolStart(tool, argsPreview, evt.toolCallId);   // 透传 id
}
if (evt.type === "tool_execution_update") {
  const text = extractContentText(evt.partialResult);        // 已有提取逻辑
  if (text) await run?.toolUpdate(String(evt.toolName), evt.toolCallId, text.slice(-200));
}
if (evt.type === "tool_execution_end") {
  const resultPreview = extractContentText(evt.result)?.slice(0, 160);
  await run?.toolEnd(tool, isError, evt.toolCallId, resultPreview);
}
```

### P1-4 `packages/executor-acp/src/session-updates.ts`

- `agent_thought_chunk` → `run?.thinkingDelta(text)`(替代 status 折叠;onLog debug 保留)
- `tool_call_update` 且 `status === "in_progress"` 且含 content → `run?.toolUpdate(...)`
- 新增 `case "plan"`:→ `run?.status(`计划 › ${entries.length} 步:${first}`)`
- `tool_call` / `tool_call_update` 透传 `update.toolCallId`

### P1-5 `apps/web` RunConsole 升级

- `toolRows` 改用 `toolCallId` 配对(无 id 回退名称匹配),行数据增加 `argsPreview / outputPreview / resultPreview`
- 工具行可点击展开 `<details>`:参数、运行中输出、结果摘要
- 思考区:`run.thinkingText` 非空时渲染折叠块(默认收起,active 时标题显示「思考中…」动画点)
- compact 模式(聊天卡片):思考只显示「思考中…」状态,不展开内容

### P1-6 测试

| 包 | 用例 |
|----|------|
| shared `run.test.ts` | thinking.delta 累积/截断;tool.update schema;旧事件 JSON 重放兼容 |
| executor-pi 新增 `events.test.ts` | mock AgentSessionEvent 序列 → 断言 RunDeltaEvent 输出(thinking/toolCallId/resultPreview) |
| executor-acp `session-updates.test.ts` | thought→thinking.delta;plan→status;in_progress→tool.update |

---

## 四、P2 修改计划:Coach 聊天流式(代码级)

### 策略(关键决策)

当前 `coachAgentReplyLlm` 用 `generateObject` 一次拿 `{ message, intent, refined }`。流式与结构化输出冲突,采用**两阶段方案**:

1. 先用已有 intent 分类(轻量)判断意图;
2. `chitchat / consult / progress` → `streamText` 纯文本流式(占聊天大多数);
3. `task / rework`(要出工单) → 保持 `generateObject` 不流式,UI 显示「正在整理工单…」状态条。

> 不选「全部 streamText 再二次提取 refined」:两次调用成本翻倍,且免费模型 JSON 不稳。

### P2-1 `packages/shared/src/events.ts`

```typescript
// SseEventTypeSchema 增加 "coach.delta" | "coach.stream.end"
z.object({
  type: z.literal("coach.delta"),
  conversationId: z.string(),
  streamId: z.string(),
  delta: z.string(),
  timestamp: z.string(),
}),
z.object({
  type: z.literal("coach.stream.end"),
  conversationId: z.string(),
  streamId: z.string(),
  timestamp: z.string(),
}),
```

### P2-2 `packages/coach/src/llm.ts`

新增(直接仿 `connect-client/src/llm.ts`):

```typescript
export async function coachChatStreamLlm(
  message: string,
  context: CoachChatContext,
  settings: ModelSettingsSlice,
  onDelta: (delta: string) => Promise<void>,
  env?: LlmEnv,
  chatHistory: CoachChatTurn[] = [],
): Promise<string> {
  const creds = resolveLlmCredentials(settings, "coach", env);
  const result = streamText({
    model: createModel(creds),
    system: buildAgentSystemPrompt(context),   // 纯文本版,无 JSON 约束
    prompt: buildChatUserPrompt(message, chatHistory),
    temperature: 0.3,
    abortSignal: coachLlmAbortSignal().signal,
  });
  let full = "";
  for await (const delta of result.textStream) {
    full += delta;
    await onDelta(delta);
  }
  return full.trim();
}
```

`service.ts` 的 `coachChatReply` 增加可选 `onDelta`:有则走流式分支(非 task 意图),无则保持原行为(测试/规则回退不受影响)。

### P2-3 `apps/server/src/routes/coach.ts`

```typescript
const streamId = crypto.randomUUID();
let buf = ""; let lastEmit = 0;
const onDelta = async (delta: string) => {
  buf += delta;
  const now = Date.now();
  if (buf.length >= 24 || now - lastEmit >= 80) {     // 节流
    broadcast({ type: "coach.delta", conversationId, streamId, delta: buf, timestamp: ... });
    buf = ""; lastEmit = now;
  }
};
// 完成:flush 余量 → saveCoachMessage → broadcast(coach.reply 含 streamId 之外原有字段) → broadcast(coach.stream.end)
// 失败:broadcast(coach.stream.end) → 走现有错误 reply 路径(warn 气泡)
// HTTP 响应仍返回完整 JSON(兜底,行为不变)
```

### P2-4 `apps/web/src/lib/app-state.tsx`

```typescript
coachStream: { conversationId: string; streamId: string; text: string } | null
// coach.delta  → 同 streamId 追加 text(不同 streamId 则替换)
// coach.stream.end / coach.reply → 清空 coachStream
```

### P2-5 `apps/web/src/components/ChatPanel.tsx`

- `coachStream`(当前会话)非空 → 消息列表尾部渲染流式气泡:partial 文本 + 闪烁光标
- `coach.reply` 到达 → 流式气泡消失、正式消息入列(现 `appendCoachIfNew` 按 text 去重已可避免重复)
- 发送按钮文案:流式中显示「回复中…」;task 意图等待时显示「整理工单中…」

### P2-6 css

打字机光标(`@keyframes blink`)、流式气泡淡入。

---

## 五、更好的优化方向(超出原计划,按收益排序)

| # | 方向 | 说明 | 层 |
|---|------|------|-----|
| O1 | **toolCallId 配对**(并入 P1) | 修 RunConsole 同名工具配错 bug | web |
| O2 | **SSE 断线对账** | `onGap` 时对 active runs 重新 `getGoalRun`(目前仅 refreshGoals,run 流可能缺帧) | web |
| O3 | **run_events 写库合并** | text.delta 当前逐条写 SQLite + 广播;服务端 run-service 增加 200ms 合并窗口,DB 写入降一个量级 | server |
| O4 | **liveText markdown 渲染** | 完成态(非 active)把 liveText 用 ChatMarkdown 渲染,代码块/列表可读性大增;active 时保持 pre 防抖 | web |
| O5 | **思考自动收纳** | run.end 后思考区自动折叠并标记「思考(N 字)」,减少视觉噪音 | web |
| O6 | **对话消息模型升级(远期)** | ChatMessage 从 `{role,text}` 升级为 discriminated union(`text` / `execution` / `refined-card`),执行卡片成为持久消息而非浮动尾部卡;向 Cursor/Codex 式对话流靠拢,需 coach_messages 表加 kind 列 | 全栈 |
| O7 | **Pi `compaction_*` / `auto_retry_*` 透传**(远期) | 长任务上下文压缩、自动重试目前完全静默,可作为 status 事件透传 | executor |

---

## 六、自测表

### P1 手动验证

| # | 场景 | 步骤 | 预期 |
|---|------|------|------|
| T1 | Pi 思考流 | 用支持 thinking 的模型派任务,开详情页 | 思考折叠区出现,内容增量更新;完成后自动收起 |
| T2 | 工具详情 | 派一个多工具任务 | 工具行可展开:参数预览/运行中输出/结果摘要;失败行红色 |
| T3 | 同名工具并发 | 让 Pi 并行读多个文件 | 工具行 start/end 配对正确(toolCallId) |
| T4 | ACP plan | 连 ACP CLI 派单 | 出现「计划 › N 步」status;思考为折叠区而非刷屏 status |
| T5 | 旧数据重放 | 升级后打开旧任务详情 | 历史 run 正常显示,无 schema 报错 |

### P2 手动验证

| # | 场景 | 步骤 | 预期 |
|---|------|------|------|
| T6 | 流式闲聊 | 问 Coach「今天做了什么」 | 文字逐段出现 + 光标;完成后气泡转正、无重复 |
| T7 | 工单不回归 | 说「帮我做 X 功能」 | 显示「整理工单中…」,RefinedPreviewCard 正常出现(不流式) |
| T8 | 多 tab | 两个 tab 同一对话 | 两边同时流式,最终一致(streamId 幂等) |
| T9 | 错误兜底 | 断网/配额用尽 | warn 错误气泡,无残留半截流式气泡 |
| T10 | 规则回退 | 不配 LLM 时聊天 | 行为与现在一致(规则模板,不流式) |

### 自动化

```
pnpm --filter @openx/shared test          # 新 schema + applyRunDelta
pnpm --filter @openx/executor-pi test     # handlePiEvent 映射
pnpm --filter @openx/executor-acp test    # session-updates 映射
pnpm --filter @openx/coach test           # stream 分支 + 规则回退
pnpm --filter @openx/server test          # coach.delta 广播 / stream.end
pnpm -r exec tsc --noEmit                 # 全仓类型
```

---

## 七、实施顺序

1. ~~P0 接线(已完成)~~
2. **P1**:shared schema → executor-core emitter → Pi/ACP 映射 → RunConsole → 测试(~1 天,自底向上,每层可独立 typecheck)
3. **P2**:events schema → coach streamText → server 路由 → 前端流式气泡(~1 天)
4. **O2/O3** 稳定性优化随 P1/P2 顺手做;O4-O7 按需排期
