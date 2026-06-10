# OpenX

工头层 Agent 控制台：目标看板、OpenX Coach（提示词优化/约束）、**以 Pi RPC 为本机执行基础**（Mock 仅演示）。

## 要求

- Node.js 20+
- pnpm 9+

## 开发

```bash
pnpm install
pnpm dev
```

- Web: http://localhost:5173
- API: http://127.0.0.1:3921

数据目录：`%USERPROFILE%\.openx\`（SQLite + config.json）

### Coach LLM

OpenX Coach 使用与 [OpenCode](vendors/opencode) 相同的成熟栈：**Vercel AI SDK**（`ai`）+ **`@ai-sdk/openai-compatible`**。未配置时自动回退**规则模板**。

**零配置试用（OpenCode Zen 免费）**

1. 打开 Web **设置 → Coach**，点击 **「应用 OpenCode Zen 免费预设」** 并保存。
2. 顶栏显示 `Coach Zen 免费 · big-pickle`（可换 `deepseek-v4-flash-free` 等）。
3. 与 OpenCode CLI 相同：无 Key 时使用 `public`，仅 `cost.input=0` 的模型；超额会提示中文说明。

**自有 Key**

1. 复制 `.env.example` 填写 `OPENX_LLM_API_KEY`，或设置里选「自定义端点」。
2. Coach 模式选 **LLM** 后保存。

执行器（Pi 等）仍自带 LLM；Coach 只负责优化目标与元对话。

## 文档

- [正式版产品核心](docs/openx-product-core.md)
- [UI 设计规范](docs/openx-ui-design-spec.md)
- [阶段设计（HTML）](docs/openx-stage-design.html)
- [地基调研](docs/openx-foundation-survey.html)
- [Vendor 目录](docs/openx-vendors-catalog.html)

## 结构

```
apps/server   Hono API + SQLite + SSE
apps/web      Vite React 四宫格 UI
packages/*    shared, coach, executor-*
vendors/      第三方参考（不依赖）
```
