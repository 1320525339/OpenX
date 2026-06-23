# AGENTS.md

This file provides guidance to Qoder (qoder.com) when working with code in this repository.

## Project Overview

OpenX is a **Foreman (包工头) system** — it decomposes user task intents, applies constraints/context, dispatches work orders to external CLI Agents (施工队), monitors execution, reviews results, and triggers rework when needed. It does NOT build its own LLM runtime or coding agent; it orchestrates existing ones.

All UI text, comments, logs, and error messages are in **Chinese (中文)**.

## Build & Development Commands

**Prerequisites**: Node.js 20+, pnpm 9+

```powershell
# Install all dependencies
pnpm install

# Full dev (builds packages first, then runs server + web in parallel)
pnpm dev

# Dev individual apps
pnpm dev:server    # Server only (tsx --watch, port 3921)
pnpm dev:web       # Web only (vite, port 5173)

# Build everything (all packages + apps)
pnpm build

# Typecheck everything
pnpm typecheck

# Run all tests
pnpm test

# Run tests for a specific workspace
pnpm --filter @openx/server test
pnpm --filter @openx/web test
pnpm --filter @openx/shared test
pnpm --filter @openx/coach test
pnpm --filter @openx/executor-core test

# Run a single test file (from workspace root)
pnpm --filter @openx/server exec vitest run src/<file>.test.ts

# E2E tests (require running server)
pnpm e2e:acp           # ACP executor e2e (mock mode)
pnpm e2e:connect       # Connect auto-bootstrap e2e
pnpm e2e:acp-dispatch  # ACP dispatch e2e
pnpm e2e:self          # Self-bootstrap e2e
pnpm vendors:zvec      # 拉取 alibaba/zvec 到 vendors/zvec（只读参考）
```

Web dev server proxies `/api` and `/internal` to the server at `127.0.0.1:3921`.

Data directory (`~/.openx/`):
- `openx.db` — SQLite database (WAL mode)
- `config.json` — Settings (with revision-based optimistic locking)
- `providers.json` — LLM provider pool (migrated out of config.json)
- `.env` — API keys (secrets, not in config.json)
- `internal.token` — Internal API auth token

## Architecture

### Three-Layer Architecture

```
用户层 (apps/web)           — Vite + React 19 SPA, set goals, view status, Coach dialogue
工头层 (apps/server)        — Hono API + SQLite + SSE, goal decomposition/dispatch/lifecycle
执行层 (packages/executor-*) — Adapter-based executor plugins (Pi, ACP, Connect, Mock)
```

### Monorepo Structure

pnpm workspace with `packages/*` and `apps/*`. All packages are `@openx/*` scoped, ESM (`"type": "module"`), TypeScript with `NodeNext` module resolution. The `vendors/` directory contains third-party reference code (gitignored, read-only).

### Key Packages

- **`@openx/shared`** — Type definitions, schemas (Zod), and pure logic shared across server/web/packages. Contains Goal state machine, Coach types, executor types, LLM provider config, settings schema, etc. Almost everything depends on this.
- **`@openx/coach`** — Coach LLM service using Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible`). Handles goal refinement (structured output), chat, review, and foreman crew dialogue. Falls back to rule templates when no LLM is configured.
- **`@openx/executor-core`** — Defines `ExecutorAdapter` interface and the executor registry. All executors implement `run(ctx)` with callbacks (`onProgress`, `onLog`, `onComplete`, `onFail`, `onCrewQuestion`). Supports `push` and `pull` execution models.
- **`@openx/executor-pi`** — Pi coding agent adapter (embedded `@earendil-works/pi-coding-agent`). Default executor for new goals. Supports isolated worker process mode.
- **`@openx/executor-acp`** — Agent Client Protocol adapter. Spawns external CLI agents (Codex, Claude, etc.) via ACP SDK subprocess.
- **`@openx/executor-connect`** — Connect (heartbeat-based) adapter for remote agents that poll for work via `/api/connect/*` endpoints.
- **`@openx/executor-mock`** — Mock executor for testing/demo without LLM credentials.
- **`@openx/mcp-openx`** — MCP server exposing OpenX APIs as tools (for external agents to interact with OpenX).
- **`@openx/connect-client`** — Standalone CLI client for the Connect protocol.
- **`browserface`** — Lightweight browser interface for live CDP browser sessions.

### Server Architecture (apps/server)

- **Entry**: `src/index.ts` — Hono HTTP server + WebSocket for browser CDP. Starts watchdogs (Connect, Pi, ACP) on boot.
- **Routes**: `src/routes/` — Modular Hono route files: `goals.ts`, `coach.ts`, `connect.ts`, `cli.ts`, `model.ts`, `browser.ts`, `desktop.ts`, `operator.ts`, `island.ts`, `bootstrap.ts`, `system.ts`, `projects.ts`, `internal.ts`.
- **Orchestrator** (`src/orchestrator.ts`): Central dispatch engine. Registers all executor adapters, resolves `auto` executor selection (via Pi LLM or rule-based recommendation), builds `ExecutorContext`, manages dispatch locks, handles rework steering, and auto-dispatches dependent goals.
- **Database** (`src/db.ts`): `better-sqlite3` with WAL mode. Single SQLite file at `~/.openx/openx.db`. Schema migrations inline via `ensureColumn`/`ensureTable`. Key tables: `goals`, `goal_logs`, `coach_messages`, `execution_summaries`, `sse_events`, `conversations`, `projects`.
- **SSE** (`src/sse.ts`): Server-Sent Events for real-time push to web client. Events are persisted in `sse_events` table for catchup on reconnect.
- **Settings** (`src/settings-store.ts`): JSON file at `~/.openx/config.json`. Contains LLM providers, model mappings, executor config, CLI profiles, MCP servers, etc.
- **Goal Lifecycle** (`src/goal-lifecycle.ts`, `src/goal-actions.ts`): GoalStatus 6 态（见下方状态机）。Rework 是 `awaiting_review → running`（附 `effectStatus="rework"`），非独立状态。
- **Auto-Review** (`src/auto-review.ts`): After goal completion, Coach LLM reviews deliverables against acceptance criteria. Can trigger rework with `maxIterations` guard (default 20). Includes `review-verify.ts` that runs actual test commands and reads files to verify completion.
- **Goal Completion Gate** (`src/goal-completion-gate.ts`): Blocks parent goal completion until all non-waived child goals are done.
- **Sub-Goal Routing** (`src/sub-goals.ts`): When parent review fails, routes rework to specific child goals via `routeParentReviewFail()`.
- **Foreman Loop** (`src/foreman-loop.ts`): Handles `CrewQuestion` from executors — either answers via Coach LLM (foreman rule) or escalates to user.
- **Watchdogs**: `connect-watchdog.ts`, `pi-watchdog.ts`, `acp-watchdog.ts` — Monitor and restart executor processes.

### Web Architecture (apps/web)

- **React 19** with Vite. No router — view state managed via `AppView` in `SideNav`.
- **State**: Single `useReducer`-based `AppProvider` context (`src/lib/app-state.tsx`) managing goals, projects, conversations, settings, SSE event handling, and run state.
- **API Client** (`src/api.ts`): Typed fetch wrapper with SSE connection (`connectEvents`) for real-time updates.
- **Styling**: CSS files in `src/styles/`, multiple theme variants. Uses `@onlook/babel-plugin-react` for design tool integration.
- **Mermaid**: Used for diagram previews in goal refinement (`mermaid` package).

### Goal State Machine

GoalStatus has **6 states** (defined in `@openx/shared` `goal.ts`):

```
draft ──→ running ──→ awaiting_review ──→ done
  │          │              │
  │          │              └──→ running  (rework loop, effectStatus="rework")
  │          │
  │          └──→ failed ──→ running  (retry)
  │               │
  ↓               ↓
cancelled     cancelled
```

`canTransition()` allowed transitions:
- `draft` → `running`, `cancelled`
- `running` → `awaiting_review`, `failed`, `cancelled`
- `awaiting_review` → `done`, `running` (rework), `cancelled`
- `failed` → `running`, `cancelled`
- `done` → (terminal)
- `cancelled` → (terminal)

**Important**: `rework` is NOT a GoalStatus — it is an `EffectStatus` (`"approved" | "rework"`) on the Goal object. The rework loop is `awaiting_review → running` with `goal.effectStatus = "rework"` set. `done` and `cancelled` are both terminal states.

Sub-goal dependencies via `dependsOn` enable chained execution. Parent goals are blocked by `goal-completion-gate` until all children complete.

### Executor Adapter Pattern

New executors implement `ExecutorAdapter` from `@openx/executor-core`:
- `id` / `displayName` — identifier
- `detect(settings)` — check availability
- `run(ctx: ExecutorContext)` — execute a goal with callbacks
- Optional: `steerRework()`, `cancel()`, `matchExecutorId()`, `detectEntries()`

Register via `registerExecutor()` in orchestrator's `ensureExecutors()`.

### LLM Configuration

Shared provider pool in `settings.providers` (JSON). Coach, Pi, and other roles reference models via `settings.model.{coach,pi,default}` as `slug/modelId`. Built-in templates (`LLM_PROVIDER_TEMPLATES`) for OpenCode Zen, OpenAI, DeepSeek, etc.

### Key Environment Variables

- `PORT` — Server port (default: 3921)
- `HOST` — Server host (default: 127.0.0.1)
- `OPENX_MOCK_PI=1` — Use mock executor instead of real Pi
- `OPENX_LLM_API_KEY` / `OPENX_LLM_BASE_URL` / `OPENX_LLM_MODEL` — Coach LLM config (also configurable via web UI settings)
- `OPENX_PI_WORKER=1` — Enable Pi worker process mode
- `OPENX_FOREMAN_RULES_ONLY=1` — Force foreman to use rules only (no LLM)
- `OPENX_DB_PATH` — Override SQLite DB path (use `:memory:` for tests)
- `OPENX_CONFIG_PATH` — Override config.json path
- `OPENX_PROVIDERS_PATH` — Override providers.json path
- `OPENX_DOTENV_PATH` — Override .env path
- `OPENX_KNOWLEDGE_DISTILL_INTERVAL_MS` — 项目运行知识定时蒸馏间隔（默认 30 分钟）

## Testing

- **Framework**: Vitest with `vmThreads` pool (server) and `threads` pool (web/jsdom)
- **Test timeout**: 180s (server), default (web)
- **Test files**: `*.test.ts` / `*.test.tsx` colocated with source
- **Server test command**: `node --experimental-vm-modules node_modules/vitest/vitest.mjs run`
- All test files are excluded from TypeScript compilation (`tsconfig.json`)

## Important Conventions

- All packages use ESM with `"type": "module"` and `NodeNext` module resolution
- TypeScript `strict` mode with `noUnusedLocals` and `noUnusedParameters`
- Imports must include `.js` extension (e.g., `import { foo } from "./bar.js"`)
- Database migrations are inline (imperative `ensureColumn`/`ensureTable` calls), not separate migration files
- `vendors/` is gitignored and read-only — reference code only, no modifications
- The `@openx/shared` package exports multiple sub-paths (`./skills-path`, `./agents-path`) in addition to the main entry
- Settings has deprecated fields: `workspaceRoot` (use `systemWorkspaceRoot`) and `coach` (use `model` + `providers`); read-time auto-migration handles legacy data
- Settings save uses revision-based optimistic locking (`SettingsRevisionConflictError`)
- Providers pool was migrated to separate `providers.json` file (see `providers-store.ts` / `providers.json`)
