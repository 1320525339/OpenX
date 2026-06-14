#!/usr/bin/env node
/**
 * CLI 完整流程 E2E：Coach 多轮对话 → 复杂派单 → 工头↔施工队 → 验收 → 返工 → 再验收
 *
 * 用法:
 *   node scripts/e2e-cli-full-flow.mjs
 *   node scripts/e2e-cli-full-flow.mjs --mock          # Mock ACP + 规则工头（CI）
 *   node scripts/e2e-cli-full-flow.mjs --server        # 使用已有 3921 服务
 *
 * 环境: OPENX_BASE, OPENX_E2E_TIMEOUT_MS（默认 600000）, OPENX_WORKSPACE
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ARTIFACTS = join(ROOT, "scripts", "e2e-artifacts", "cli-full-flow");
const MOCK_PORT = 3923;
const DEFAULT_BASE = "http://127.0.0.1:3921";
const BASE_ENV = process.env.OPENX_BASE ?? DEFAULT_BASE;
const TIMEOUT_MS = Number(process.env.OPENX_E2E_TIMEOUT_MS ?? 600_000);
const POLL_MS = 3000;
const FETCH_MS = Number(process.env.OPENX_E2E_FETCH_MS ?? 20_000);
const COACH_FETCH_MS = Number(process.env.OPENX_COACH_FETCH_MS ?? 120_000);

const forceMock = process.argv.includes("--mock");
const useExistingServer = process.argv.includes("--server");

const COMPLEX_PROMPT = [
  "【重要】不要向用户/developer 提问；有疑问只向工头请示。",
  "【重要】未写入指定产物文件前，禁止结束任务。",
  "",
  "【强制流程】在写任何代码或调用工具之前，必须先向工头请示实现方案。",
  "用自然语言请示，例如：",
  "【请示工头】",
  "我打算先读 cli.ts 再写产物文件，这样行吗？",
  "收到【工头】回复后再动手。",
  "",
  "【任务】在仓库根目录完成（必须读源码）：",
  "1. 阅读 apps/server/src/routes/cli.ts，找出更新 acp-config 的 HTTP 方法与路径模式",
  "2. 写入 scripts/e2e-artifacts/cli-full-flow/acp-route.txt，严格两行：",
  "   METHOD=<大写方法>",
  "   PATH=<路径模式，含 :executorId>",
  "3. resultSummary 用中文复述 METHOD 与 PATH",
].join("\n");

const results = [];

function step(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function json(base, path, init, timeoutMs = FETCH_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      ...init,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`${path} → ${res.status}: ${body.error ?? JSON.stringify(body)}`);
    }
    return body;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`${path} → 请求超时 (${timeoutMs}ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHttp(base) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  throw new Error(`服务未就绪: ${base}`);
}

function startMockServer() {
  return spawn("npx", ["tsx", "src/index.ts"], {
    cwd: join(ROOT, "apps/server"),
    env: {
      ...process.env,
      PORT: String(MOCK_PORT),
      OPENX_ACP_MOCK: "1",
      OPENX_DB_PATH: ":memory:",
      OPENX_FOREMAN_RULES_ONLY: "1",
    },
    shell: true,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function crewDialogueFromLogs(logs) {
  const asked = logs?.find((l) =>
    /施工队提问|crew_to_foreman|crew-question/.test(l.message),
  );
  const answered = logs?.find((l) =>
    /工头指令|foreman_to_crew|工头 LLM 决策|回退规则引擎/.test(l.message),
  );
  if (!asked || !answered) return null;
  return {
    question: { summary: asked.message.replace(/^\[[^\]]+\]\s*/, "").slice(0, 120) },
    directive: { summary: answered.message.replace(/^\[[^\]]+\]\s*/, "").slice(0, 120) },
  };
}

async function waitForCrewDialogue(base, goalId) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const { messages } = await json(base, `/api/goals/${goalId}/crew-messages`);
      const question = messages.find((m) => m.direction === "crew_to_foreman");
      const directive = messages.find((m) => m.direction === "foreman_to_crew");
      if (question && directive) return { question, directive, messages };
    } catch {
      /* fallback logs */
    }
    const { logs } = await json(base, `/api/goals/${goalId}`);
    const fromLogs = crewDialogueFromLogs(logs);
    if (fromLogs) return fromLogs;
    await sleep(POLL_MS);
  }
  throw new Error("工头↔施工队对话超时");
}

async function waitForGoalStatus(base, goalId, statuses, label) {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastLog = "";
  while (Date.now() < deadline) {
    const { goal, logs } = await json(base, `/api/goals/${goalId}`);
    const tail = logs?.[logs.length - 1];
    if (tail && tail.message !== lastLog) {
      lastLog = tail.message;
      console.log(`    [${goal.status} ${goal.progress ?? 0}%] ${tail.message.slice(0, 100)}`);
    }
    if (statuses.includes(goal.status)) return goal;
    await sleep(POLL_MS);
  }
  const { goal } = await json(base, `/api/goals/${goalId}`);
  throw new Error(`${label}: 超时，status=${goal.status}`);
}

async function resolveConversation(base, titleSuffix) {
  const workspace = process.env.OPENX_WORKSPACE ?? ROOT;
  let { projects } = await json(base, "/api/projects");
  let project = projects.find((p) => p.workspaceDir === workspace) ?? projects[0];
  if (!project) {
    project = (
      await json(base, "/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: "CLI Full Flow E2E", workspaceDir: workspace }),
      })
    ).project;
  }
  const title = `CLI Full Flow ${titleSuffix} ${Date.now().toString(36)}`;
  const conv = (
    await json(base, `/api/projects/${project.id}/conversations`, {
      method: "POST",
      body: JSON.stringify({ title }),
    })
  ).conversation;
  return conv.id;
}

async function coachChat(base, conversationId, message) {
  return json(
    base,
    "/api/coach/chat",
    {
      method: "POST",
      body: JSON.stringify({ conversationId, message }),
    },
    COACH_FETCH_MS,
  );
}

async function listCoachMessages(base, conversationId) {
  const { messages } = await json(
    base,
    `/api/coach/messages?conversationId=${conversationId}`,
  );
  return messages;
}

function verifyArtifact() {
  const p = join(ARTIFACTS, "acp-route.txt");
  if (!existsSync(p)) throw new Error("缺少 acp-route.txt");
  const text = readFileSync(p, "utf8");
  if (!/METHOD=PUT/i.test(text)) throw new Error("METHOD 应为 PUT");
  if (!/PATH=.*acp-config/i.test(text)) throw new Error("PATH 应含 acp-config");
}

async function pickExecutor(base, mockMode) {
  const { executors } = await json(base, "/api/executors");
  if (mockMode) {
    const mock = executors.find((e) => e.id === "acp:claude" || e.id === "acp:codex");
    if (!mock?.available) throw new Error("Mock 模式下无可用 ACP");
    return mock.id;
  }
  const claude = executors.find((e) => e.id === "acp:claude");
  if (claude?.available) return "acp:claude";
  throw new Error("acp:claude 不可用，请配置 DeepSeek 或加 --mock");
}

async function runFullFlow(base, mockMode) {
  console.log(`\n=== CLI 完整流程 E2E (${mockMode ? "Mock" : "真实 Claude"}) ===`);
  console.log(`Base: ${base}  timeout: ${TIMEOUT_MS / 1000}s\n`);

  if (existsSync(ARTIFACTS)) rmSync(ARTIFACTS, { recursive: true, force: true });
  mkdirSync(ARTIFACTS, { recursive: true });

  const coachConvId = await resolveConversation(base, "Coach多轮");
  const dispatchConvId = await resolveConversation(base, "派单执行");
  step("setup_coach_conversation", Boolean(coachConvId), coachConvId);
  step("setup_dispatch_conversation", Boolean(dispatchConvId), dispatchConvId);

  // ── Phase 1: Coach 多轮对话（独立会话，不污染派单上下文）──
  console.log("\n--- Phase 1: Coach 多轮对话 ---");
  const r1 = await coachChat(base, coachConvId, "你好，我想通过 CLI 施工队完成一个复杂任务");
  step("coach_round1", Boolean(r1.message), r1.message?.slice(0, 60));

  const r2 = await coachChat(
    base,
    coachConvId,
    "帮我梳理：读取 apps/server/src/routes/cli.ts 里 acp-config 的路由，写入产物文件验收",
  );
  step(
    "coach_round2_refined",
    Boolean(r2.refined?.title || r2.suggestRefine),
    r2.refined?.title ?? "(无 refined)",
  );

  let refinedMsg = (await listCoachMessages(base, coachConvId))
    .filter((m) => m.kind === "refined")
    .at(-1);

  if (refinedMsg?.id) {
    const confirm = await json(
      base,
      `/api/coach/refined/${refinedMsg.id}/respond`,
      {
        method: "POST",
        body: JSON.stringify({ conversationId: coachConvId, outcome: "confirmed" }),
      },
      COACH_FETCH_MS,
    );
    step("coach_confirm_refined", Boolean(confirm.message), confirm.message?.slice(0, 60));
  } else {
    step("coach_confirm_refined", false, "缺少 refined 消息");
  }

  const r3 = await coachChat(
    base,
    coachConvId,
    "好的，请派给 Claude 施工队，需要先问工头再动手",
  );
  step("coach_round3", Boolean(r3.message), r3.message?.slice(0, 60));

  // ── Phase 2: 复杂派单 + 工头对话 ──
  console.log("\n--- Phase 2: 复杂派单 + 工头↔施工队 ---");
  const executorId = await pickExecutor(base, mockMode);
  step("executor_ready", true, executorId);

  if (!mockMode) {
    const { config } = await json(
      base,
      `/api/cli/acp-config/${encodeURIComponent("acp:claude")}`,
    );
    step(
      "acp_claude_config",
      config?.synced && config?.modelReady,
      `${config?.modelRef ?? "?"} synced=${config?.synced}`,
    );
    if (!config?.synced) {
      throw new Error("请先 node scripts/setup-deepseek.mjs 配置 acp:claude");
    }
  }

  const title = `CLI完整流-${mockMode ? "Mock" : "Claude"}-${Date.now().toString(36)}`;
  const createBody = {
    conversationId: dispatchConvId,
    userDraft: "CLI 完整流：ACP 路由 + 工头对话",
    title,
    acceptance: "完成工头对话且 acp-route.txt 格式正确",
    executionPrompt: COMPLEX_PROMPT,
    executorId,
    autoStart: true,
    autoReview: false,
  };

  const { goal } = await json(base, "/api/goals", {
    method: "POST",
    body: JSON.stringify(createBody),
  });
  step("goal_dispatch", goal.status === "running" || goal.status === "draft", `${goal.id} ${goal.status}`);

  console.log("  等待工头↔施工队对话…");
  const crew = await waitForCrewDialogue(base, goal.id);
  step(
    "crew_dialogue",
    Boolean(crew.question?.summary && crew.directive?.summary),
    `Q: ${crew.question.summary.slice(0, 50)} → A: ${crew.directive.summary.slice(0, 50)}`,
  );

  console.log("  等待首次待验收…");
  const awaiting1 = await waitForGoalStatus(
    base,
    goal.id,
    ["awaiting_review", "done", "failed"],
    "首次执行",
  );
  step(
    "goal_awaiting_review_1",
    awaiting1.status === "awaiting_review" || awaiting1.status === "done",
    `${awaiting1.status} ${awaiting1.resultSummary?.slice(0, 80) ?? ""}`,
  );
  if (awaiting1.status === "failed") {
    throw new Error(`首次执行失败: ${awaiting1.resultSummary ?? "unknown"}`);
  }

  try {
    verifyArtifact();
    step("artifact_verify_1", true, "acp-route.txt OK");
  } catch (e) {
    step("artifact_verify_1", false, e.message);
    throw new Error(`产物校验失败: ${e.message}`);
  }

  // ── Phase 3: 返工循环 ──
  console.log("\n--- Phase 3: 返工 → 再验收 ---");
  const reworkRes = await json(
    base,
    `/api/goals/${goal.id}/rework`,
    {
      method: "POST",
      body: JSON.stringify({
        reason: "请在 resultSummary 末尾追加「【返工完成】」再提交",
      }),
    },
    COACH_FETCH_MS,
  );
  const reworked = reworkRes.goal ?? reworkRes;
  step(
    "goal_rework",
    reworked.status === "running" && reworked.effectStatus === "rework",
    `status=${reworked.status}`,
  );

  const awaiting2 = await waitForGoalStatus(
    base,
    goal.id,
    ["awaiting_review", "done", "failed"],
    "返工后执行",
  );
  step(
    "goal_awaiting_review_2",
    awaiting2.status === "awaiting_review" || awaiting2.status === "done",
    `${awaiting2.status}`,
  );
  if (awaiting2.status === "failed") {
    throw new Error(`返工后失败: ${awaiting2.resultSummary ?? "unknown"}`);
  }

  // ── Phase 4: 用户验收 ──
  console.log("\n--- Phase 4: 验收 approve ---");
  const r4 = await coachChat(base, coachConvId, "施工队完成了，帮我看看可以验收了吗？");
  step("coach_pre_approve", Boolean(r4.message), r4.message?.slice(0, 60));

  const approveRes = await json(
    base,
    `/api/goals/${goal.id}/approve`,
    { method: "POST" },
    COACH_FETCH_MS,
  );
  const doneGoal = approveRes.goal ?? (await json(base, `/api/goals/${goal.id}`)).goal;
  step("goal_approve", doneGoal.status === "done", `status=${doneGoal.status}`);

  const r5 = await coachChat(base, coachConvId, "验收通过了，谢谢");
  step("coach_post_approve", Boolean(r5.message), r5.message?.slice(0, 60));

  const msgs = await listCoachMessages(base, coachConvId);
  const coachRounds = msgs.filter((m) => m.kind === "text" && (m.role === "user" || m.role === "coach"));
  step("coach_thread_depth", coachRounds.length >= 6, `messages=${coachRounds.length}`);

  console.log("\n--- 汇总 ---");
  const failed = results.filter((r) => !r.ok);
  console.log(`通过 ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    console.error("失败:", failed.map((f) => f.name).join(", "));
    process.exit(1);
  }
  console.log(`\n=== CLI 完整流程 E2E 通过 ===\ngoalId=${goal.id}\n`);
}

async function main() {
  let base = BASE_ENV;
  let mockProc = null;
  let mockMode = forceMock;

  if (useExistingServer) {
    base = BASE_ENV;
    mockMode = forceMock || process.env.OPENX_ACP_MOCK === "1";
  } else if (forceMock) {
    console.log(`启动 Mock server PORT=${MOCK_PORT}…`);
    mockProc = startMockServer();
    base = `http://127.0.0.1:${MOCK_PORT}`;
    mockMode = true;
    process.on("exit", () => mockProc?.kill());
  } else {
    try {
      const { executors } = await json(base, "/api/executors");
      const claude = executors.find((e) => e.id === "acp:claude");
      if (!claude?.available) {
        console.log("acp:claude 不可用，回退 Mock…");
        mockProc = startMockServer();
        base = `http://127.0.0.1:${MOCK_PORT}`;
        mockMode = true;
      }
    } catch {
      mockProc = startMockServer();
      base = `http://127.0.0.1:${MOCK_PORT}`;
      mockMode = true;
    }
  }

  await waitForHttp(base);
  await runFullFlow(base, mockMode);
  mockProc?.kill();
}

main().catch((err) => {
  console.error("\nCLI 完整流程 E2E 失败:", err.message);
  process.exit(1);
});
