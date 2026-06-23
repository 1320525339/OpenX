# OpenX

工头层 Agent 控制台：目标看板、OpenX Coach（提示词优化/约束）、**以 Pi RPC 为本机执行基础**（Mock 仅演示）。

## 要求

- Node.js 20+
- pnpm 9+
- Rust 1.77+（仅桌面端需要）
- Windows 10/11（已内置 WebView2）

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

## 桌面端（Tauri v2）

基于 Tauri v2 + Node.js sidecar 架构，将 Server 打包为独立 exe，由 Rust 外壳管理生命周期，前端由系统 WebView2 渲染。

### 额外环境要求

- **Rust 1.77+**：[rustup](https://rustup.rs/) 安装后 `rustc --version` 验证
- **WebView2**：Windows 10/11 已内置，无需额外安装

### 开发模式

```bash
# 首次运行会自动安装 @tauri-apps/cli
pnpm desktop:dev
```

自动启动 Vite dev server + Tauri 窗口，server sidecar 自动 spawn。支持前端热更新。

### 构建安装包

```bash
# 完整流程：server exe → web dist → Rust 编译 → 安装包
pnpm desktop:build
```

产物位于 `apps/desktop/src-tauri/target/release/bundle/nsis/`：
- `*.exe` — NSIS 安装包（当前 `tauri.conf.json` 仅启用 NSIS 目标）

### 单独构建 Server Sidecar

```bash
# 仅重新编译 server exe（跳过 Rust 编译）
pnpm --filter @openx/desktop build:server
```

产物：`apps/desktop/src-tauri/binaries/openx-server-x86_64-pc-windows-msvc.exe`

### 架构说明

```
┌─────────────────────────────────┐
│  Tauri Rust 外壳 (.exe)         │
│  ├─ 系统托盘（右键菜单）          │
│  ├─ WebView2 → React 前端       │
│  └─ Sidecar 管理                │
│     └─ openx-server.exe :3921   │
│        └─ better_sqlite3.node   │
└─────────────────────────────────┘
```

- **关闭窗口** → 隐藏到系统托盘，不退出
- **托盘右键** → 「打开 OpenX」/「退出」
- **退出时** → 自动清理 sidecar 子进程

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
apps/desktop  Tauri v2 桌面客户端（Rust + sidecar）
packages/*    shared, coach, executor-*
vendors/      第三方参考（不依赖）
```
