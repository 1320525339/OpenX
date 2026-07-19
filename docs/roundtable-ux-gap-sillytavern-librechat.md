# 圆桌 UX 差距清单：SillyTavern / LibreChat → OpenX

> 对照热门开源群聊与多模聊天交互，列出 OpenX 圆桌（已并入正式 `ChatPanel`）相对差距。  
> **用途**：产品/交互迭代优先级，不引入对方运行时。  
> **代码锚点**：[`ChatPanel.tsx`](../apps/web/src/components/ChatPanel.tsx)、[`ParticipantBar.tsx`](../apps/web/src/components/roundtable/ParticipantBar.tsx)、[`roundtable-mentions.ts`](../apps/web/src/lib/roundtable-mentions.ts)

## 1. 对照范围

| 参考 | 借什么 | 不借什么 |
|------|--------|----------|
| [SillyTavern](https://github.com/SillyTavern/SillyTavern) 群聊 | `@` 点名、成员条、发言策略、静音、气泡归因 | 角色扮演世界观、自动连发群戏 |
| [LibreChat](https://github.com/danny-avila/LibreChat) | Composer 一体、会话内换模、Agent 配置与会话点名分离 | 整站 UI、Mongo 会话模型 |

OpenX 现状：`conversation.mode === "roundtable"` 时仍用正式 `chat-turn` / `chat-bubble` / `chat-composer`；席位 = `profileId` × `modelRef`。

---

## 2. `@` 提及

| # | 能力 | SillyTavern / LibreChat | OpenX 现状 | 差距 | 建议优先级 |
|---|------|-------------------------|------------|------|------------|
| A1 | 输入 `@` 弹出候选 | ST：成员列表；LC：常见 mention/助手选择 | 有：过滤 `displayName`，含「全体」 | 无键盘上下键/Enter 选定（仅鼠标点） | P1 |
| A2 | 提及后插入可读标签 | ST：角色名；部分产品用 chip | 纯文本 `@显示名 ` | 无 chip，改名后历史 `@` 易失效 | P2 |
| A3 | 多选 / `@全体` | ST：可多人；群策略另算 | `@全体` / `@all` + 多名串行解析 | 与「发散默认前 3 人」语义需在 UI 标明 | P1（文案） |
| A4 | 提及解析边界 | 通常空白/标点截断 | `(?=$|\s|[，,、])`，长名优先 | 无英文逗号外标点、无半角名中间空格友好提示 | P3 |
| A5 | 静音成员是否可 @ | ST：可触发静音成员发言 | 静音者不在候选；路由报「未知或已静音」 | 与 ST「强制喊醒」不一致；OpenX 刻意更严 | 保持（文档说明） |
| A6 | 气泡「追问」回填 `@名` | 常见 | 有「追问」按钮回填 | 无「基于此让其他人评」入口（曾在独立圆桌面板） | P2 |
| A7 | 非圆桌模式 `@` | LC：助手/@ 常全局可用 | 仅 `roundtable` 模式解析 | 「正常对话直接加席再 @」需先 enable 圆桌 | P1（产品：一键启用后提示） |

---

## 3. 席位条（成员 / Agent × 模型）

| # | 能力 | SillyTavern / LibreChat | OpenX 现状 | 差距 | 建议优先级 |
|---|------|-------------------------|------------|------|------------|
| B1 | 会话内增删成员 | ST：群成员加减排序 | `ParticipantBar`：添加 / 移出（工头不可移） | 无拖拽排序（仅 `sortOrder` 写入顺序） | P2 |
| B2 | 静音 / 开麦 | ST：成员静音图标 | 编辑面板内静音 | 席位 chip 上无一眼静音图标（仅「（静音）」文案） | P2 |
| B3 | 角色卡 vs 本会话席位 | ST：角色库 + 入群；LC：Agent 库 + 选用 | `ai_profiles` 全局 + `conversation_participants` 会话级 | 无独立「画像库」管理页入口（仅 API/编辑下拉） | P2 |
| B4 | 每席独立模型 | ST 扩展多后端；LC 会话/Agent 换模 | chip 短名 + 编辑换 `modelRef` | 换模需点开编辑条，不能 chip 旁一键下拉 | P1 |
| B5 | 席位上限可见性 | 各异 | 最多工头 + 6 发言席，满员禁用「+ 添加」 | Composer 无「3/7」计数提示 | P3 |
| B6 | 头像 / 视觉区分 | ST：头像强 | emoji `avatar` 或默认 👷/🤖 | 无上传头像、无颜色条 | P3 |
| B7 | Composer 一体感 | LC：工具/模/Agent 同区 | 席位条替换 `ChatContextPicker` | 圆桌时丢失技能/MCP/知识选择器 | P1（是否圆桌仍保留 ContextPicker） |

---

## 4. 发言策略与群聊节奏

| # | 能力 | SillyTavern | OpenX 现状 | 差距 | 建议优先级 |
|---|------|-------------|------------|------|------------|
| C1 | 手动指定下一人 | Manual / 点成员气泡触发 | `@` 或默认工头（direct） | 无「点席位立即让其答」快捷（需打字 @） | P2 |
| C2 | 轮询 List | 有 | 无 | 可选后续；非核心 | P3 |
| C3 | Natural（LLM 选人） | 有 | 无（计划刻意不做默认自动主持） | 仅作可选「自动主持」实验 | 延后 |
| C4 | 同轮多人并行 | 少见（多为串行） | `@` 多人 / `@全体` / diverge 并行 | **OpenX 优势**；UI 缺「预计 N 路」常显（独立面板曾有） | P2 |
| C5 | 盲答（同轮互不可见） | 通常共享上下文 | diverge 排除同轮 | 用户不可见「本轮是否盲答」标记 | P2（气泡/轮次元信息） |
| C6 | 停止单路 / 全部 | 各异 | 气泡「停止」+ Composer「停止回答」 | 与正式聊天停止语义一致即可 | 已齐 |

---

## 5. 气泡与元信息

| # | 能力 | 参考 | OpenX 现状 | 差距 | 建议优先级 |
|---|------|------|------------|------|------------|
| D1 | 说话人显示名 | ST/LC | `chat-turn-role` 用席位名 / 工头 / 你 | 基本对齐 | — |
| D2 | 模型短标签 | OpenWebUI/LC | `shortModelRefLabel` | 可保留 | — |
| D3 | 流式光标 | 正式 chat | `chat-stream-cursor` + `roundStreams` | 基本对齐 | — |
| D4 | peer 确认卡 | 少有（人审门闩） | `PeerRequestCard` | **OpenX 优势**；样式已用 chat-turn 壳 | — |
| D5 | 工头总结卡 | ChatDev 式阶段产出 | `RoundSynthesisCard` → 任务单 | 缺「继续发散」工具条（仅继续讨论） | P2 |

---

## 6. 推荐落地顺序（仅清单，不强制本迭代改代码）

1. **P1**：`@` 键盘选择；圆桌 Composer 是否保留 ContextPicker；换模一键性；enable 圆桌后的引导文案。  
   - **已落地（2026-07）**：↑↓/Enter/Tab 选 `@`；席位条 + ContextPicker 同区；chip 旁模型下拉；启用提示与「预计 N 路」；静音快捷钮与席位计数。  
   - **已落地（2026-07 严谨优化）**：**同区两行**（席位行 / Skill·MCP·权限·知识 + 模式行）；去掉 `display: contents`；diverge 会话内记忆；加人成功岛通知；席位 `n/max` 常显。  
   - **已落地（2026-07 Context 接入）**：圆桌发送 `createChatRound` 透传 Skill/MCP/知识/权限；席位提示词注入清单与知识摘录；转工单 `backfill` skill/mcp；Context **不再灰显**（语义与工头一致：提示词感知，非席位现场调工具）。  
2. **P2**：追问/请他人评；席位排序与静音图标；盲答/预计路数元信息；总结后续动作。  
   - **已落地（部分）**：追问 / 让其他人评 / 基于此发散；总结卡「继续发散」；模式切换 direct/diverge + 盲答文案。拖拽排序仍未做。  
3. **P3**：解析边界、头像、席位计数。  
   - 席位计数已做；解析/头像仍待。  
4. **保持不做**：默认 LLM 自动选下一个说话人；ST 式自动连发群戏。  
5. **后续**：圆桌席位按选中 MCP/Skill **真实 tool-call**（独立大项，非本迭代）。

---

## 7. 相关文档

- 路由语义（AutoGen 对齐）：[roundtable-route-semantics-autogen.md](./roundtable-route-semantics-autogen.md)
