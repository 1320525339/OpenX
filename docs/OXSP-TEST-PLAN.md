# OXSP（OpenX Slot Protocol）测试与交付说明

## 范围（P0–P2）


| 层级  | 内容                                               | 状态  |
| --- | ------------------------------------------------ | --- |
| P0  | `packages/shared` 协议、布局纯函数、Zod schema            | ✅   |
| P1  | 服务端 `~/.openx/desktop/*` 持久化 + REST API + SSE    | ✅   |
| P2  | Web `OxspSlotRenderer`、底栏模板、localStorage ↔ 服务端同步 | ✅   |
| P3  | `browser` kind CDP screencast + 点击代理 + LLM 命令    | ✅   |


---

## 自动化测试

```bash
pnpm --filter @openx/shared build
pnpm --filter @openx/shared test
pnpm --filter @openx/server test src/desktop-service.test.ts
pnpm --filter @openx/server test src/desktop-routes.test.ts
pnpm --filter @openx/web test src/lib/pin-desktop-workspace.test.ts
pnpm --filter @openx/web test src/lib/oxsp-catalog.test.ts
pnpm --filter @openx/server typecheck
pnpm --filter @openx/web typecheck
```

### 覆盖要点

- **shared/oxsp.test.ts**：URL 规范化、slot 创建、`ext:` widget id、旧 `web:` 迁移、模板解析
- **shared/oxsp-layout**（经 oxsp.test）：拓展列计算、按列 Pin
- **server/desktop-service.test.ts**：create / command / snapshot / set_url 更新
- **server/desktop-routes.test.ts**：REST 路由 HTTP 集成（GET/POST/DELETE/command）
- **web/pin-desktop-workspace.test.ts**：多页 Pin、拓展槽列、catalog → `ext:` widget
- **web/oxsp-catalog.test.ts**：localStorage 旧 `cards[]` → `slots[]` 迁移

---

## 手动测试清单

### 1. 拓展槽 UI（Console / Conversation）

1. 启动 `pnpm dev`，打开系统 Console 或会话工作台。
2. 在拓展槽「+」菜单中：
  - **绑定 URL** → 应出现 iframe/web 视窗
  - **Browser（预留）** → iframe 占位
3. 从底栏 Pin **chat / tasks / kanban / detail** 到网格，确认拓展槽始终在「已 Pin 数 + 1」列。
4. 第四张内容卡 Pin 后应自动分页；拓展槽跟随新页。

### 2. 持久化与多端同步

1. Pin 一个网页拓展槽，刷新页面 → 布局与 catalog 应恢复。
2. 打开两个浏览器标签（同 scope），在 A 中 Pin URL → B 应通过 SSE `desktop.layout_changed` 刷新。
3. 检查 `~/.openx/desktop/console.json` 与 `console.catalog.json` 已写入。

### 3. LLM / REST API

通过 `openx_call_api` 或 curl：

```bash
# 列表
curl "http://localhost:3000/api/desktop/slots?scope=console"

# 创建 web 槽
curl -X POST "http://localhost:3000/api/desktop/slots?scope=console" \
  -H "Content-Type: application/json" \
  -d '{"kind":"web","config":{"kind":"web","url":"https://example.com"},"pinCol":0}'

# 快照
curl -X POST "http://localhost:3000/api/desktop/slots/{slotId}/command?scope=console" \
  -H "Content-Type: application/json" \
  -d '{"action":"snapshot"}'
```

预期：`slot_create` 返回 `slotId` / `widgetId`（`ext:*`）；`snapshot` 含 `snapshotText`；SSE 广播 layout 变更。

### 4. 旧数据迁移

1. 在 localStorage 写入旧键 `openx.pinDesktop.extension.console`（含 `cards[]`）。
2. 刷新 → 应迁移为 `openx.oxsp.catalog.console` 的 `slots[]`，widget 为 `ext:` 前缀。

---

## 已知限制

- **browser kind**：CDP screencast（`Page.startScreencast`）+ REST 帧拉取；UI 点击经 `/browser/:sessionId/input` 转发；LLM 可用 `browser_click` / `browser_type` / `browser_screenshot` / `navigate`。需本机 Chrome 或 `OPENX_CHROME_PATH`；测试/mock 用 `OPENX_BROWSER_MOCK=1`。
- **revision 冲突**：并发 PUT `/api/desktop/state` 可能返回 409；Web 端 debounce 600ms 上行。
- **Widget id**：新实例统一 `ext:{slotId}`；旧 `web:{id}` 只读兼容。

---

## 交付物


| 路径                                              | 说明                           |
| ----------------------------------------------- | ---------------------------- |
| `packages/shared/src/oxsp.ts`                   | 协议类型、catalog CRUD、API schema |
| `packages/shared/src/oxsp-layout.ts`            | 布局/Pin 纯函数                   |
| `apps/server/src/desktop-store.ts`              | 服务端持久化                       |
| `apps/server/src/desktop-service.ts`            | 业务逻辑                         |
| `apps/server/src/routes/desktop.ts`             | REST 路由                      |
| `apps/web/src/lib/oxsp-catalog.ts`              | 本地 catalog + 迁移              |
| `apps/web/src/lib/use-oxsp-desktop-sync.ts`     | 拉取/推送/sync                   |
| `apps/web/src/components/smart-cabin/Oxsp*.tsx` | 渲染组件                         |


---

## 回归建议（发版前）

- 全量 OXSP 自动化（shared 185 + server 7 + web 12）
- Console 拓展槽菜单（网页/浏览器模板）
- Conversation 工作台独立 scope（对话/任务/看板 Pin + 分页）
- REST API 在线验证 + LLM api-catalog 路径（集成测试覆盖）
- localStorage 旧数据迁移（`oxsp-catalog.test.ts`）

