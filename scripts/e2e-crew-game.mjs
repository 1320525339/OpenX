/**
 * 工头↔施工队 E2E：小游戏派单 + crew-question 决策
 *
 * 用法：
 *   node scripts/e2e-crew-game.mjs --mock     # Mock ACP（确定性，推荐 CI）
 *   node scripts/e2e-crew-game.mjs --real     # 真实 acp:claude（需已配置 Claude CLI）
 *   node scripts/e2e-crew-game.mjs              # 有 Claude 用真实，否则 Mock
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MOCK_PORT = 3923;
const DEFAULT_BASE = "http://127.0.0.1:3921";
const POLL_MS = 2500;
const TIMEOUT_MS = Number(process.env.OPENX_E2E_TIMEOUT_MS ?? 300_000);

const forceMock = process.argv.includes("--mock");
const forceReal = process.argv.includes("--real");
const useExistingServer = process.argv.includes("--server");

const GAME_PROMPT = [
  "请创建一个可在浏览器打开的小游戏（单个 index.html，目录 e2e-crew-game/）。",
  "",
  "【强制流程】在写任何代码或调用工具之前，必须先向工头请示：",
  "- 方案A：贪吃蛇",
  "- 方案B：打砖块",
  "用自然语言请示，例如：",
  "【请示工头】",
  "贪吃蛇和打砖块你更倾向哪个？",
  "（也可选用 ```crew-question fenced JSON，非必须）",
  "收到【工头】回复后按工头意见实现游戏，并说明如何运行。",
].join("\n");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHttp(base, path = "/api/executors") {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}${path}`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  throw new Error(`服务未就绪: ${base}`);
}

function startMockServer() {
  const proc = spawn("npx", ["tsx", "src/index.ts"], {
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
  proc.stderr?.on("data", (buf) => {
    const line = buf.toString().trim();
    if (line.includes("Error") || line.includes("error")) console.error("[mock-server]", line);
  });
  return proc;
}

const FETCH_TIMEOUT_MS = Number(process.env.OPENX_E2E_FETCH_MS ?? 15_000);

async function json(base, path, init, timeoutMs = FETCH_TIMEOUT_MS) {
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
      throw new Error(`${path} → ${res.status}: ${body.error ?? res.statusText}`);
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

function crewDialogueFromLogs(logs) {
  const asked = logs?.find((l) =>
    /施工队提问|crew_to_foreman|crew-question/.test(l.message),
  );
  const answered = logs?.find((l) =>
    /工头指令|foreman_to_crew|工头 LLM 决策|回退规则引擎/.test(l.message),
  );
  if (!asked || !answered) return null;
  const source = answered.message.includes("LLM")
    ? "foreman_llm"
    : answered.message.includes("规则")
      ? "foreman_rule"
      : "foreman_auto";
  return {
    messages: [],
    question: {
      direction: "crew_to_foreman",
      summary: asked.message.replace(/^\[[^\]]+\]\s*/, "").slice(0, 120),
    },
    directive: {
      direction: "foreman_to_crew",
      summary: answered.message.replace(/^\[[^\]]+\]\s*/, "").slice(0, 120),
      payload: { source, message: answered.message },
    },
  };
}

async function resolveConversationId(base) {
  if (process.env.OPENX_CONVERSATION_ID) return process.env.OPENX_CONVERSATION_ID;
  const boot = await json(base, "/api/bootstrap");
  if (boot.system?.conversation?.id) return boot.system.conversation.id;
  const { conversations } = await json(base, "/api/projects");
  if (conversations?.length) return conversations[0].id;
  throw new Error("无可用对话，请先创建项目/对话");
}

async function waitForGoal(base, id, predicate, label) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { goal } = await json(base, `/api/goals/${id}`);
    if (predicate(goal)) return goal;
    await sleep(POLL_MS);
  }
  const { goal } = await json(base, `/api/goals/${id}`);
  throw new Error(
    `${label}: 超时 (${TIMEOUT_MS / 1000}s)，最终 status=${goal.status} crewStatus=${goal.crewStatus ?? "?"}`,
  );
}

async function waitForCrewDialogue(base, goalId) {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const { messages } = await json(base, `/api/goals/${goalId}/crew-messages`);
      const question = messages.find((m) => m.direction === "crew_to_foreman");
      const directive = messages.find((m) => m.direction === "foreman_to_crew");
      if (question && directive) {
        return { messages, question, directive };
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }

    try {
      const { logs } = await json(base, `/api/goals/${goalId}`);
      const fromLogs = crewDialogueFromLogs(logs);
      if (fromLogs) {
        try {
          const { messages } = await json(
            base,
            `/api/goals/${goalId}/crew-messages`,
            undefined,
            8_000,
          );
          const question = messages.find((m) => m.direction === "crew_to_foreman");
          const directive = messages.find((m) => m.direction === "foreman_to_crew");
          if (question && directive) {
            return { messages, question, directive };
          }
        } catch {
          /* crew-messages 仍不可达时，用 logs 判定对话已完成 */
        }
        console.log("    （crew-messages 暂不可达，已从 goal logs 确认工头对话）");
        return fromLogs;
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }

    await sleep(POLL_MS);
  }
  throw new Error(`工头对话未出现${lastErr ? `（${lastErr}）` : ""}`);
}

async function pickExecutor(base, modeLabel) {
  const { executors } = await json(base, "/api/executors");
  if (modeLabel === "Mock ACP") {
    const mock = executors.find((e) => e.id === "acp:codex" || e.id === "acp:claude");
    if (!mock?.available) throw new Error("Mock 模式下无可用 ACP runtime");
    return mock.id;
  }
  const claude = executors.find((e) => e.id === "acp:claude");
  if (claude?.available) return claude.id;
  const codex = executors.find((e) => e.id === "acp:codex" && e.available);
  if (codex) return codex.id;
  throw new Error("无可用真实 ACP runtime（acp:claude / acp:codex）");
}

async function runCrewGameE2e(base, modeLabel) {
  console.log(`\n=== 工头↔施工队 小游戏 E2E (${modeLabel}) ===\n`);
  console.log(`Base: ${base}  timeout: ${TIMEOUT_MS / 1000}s`);

  const executorId = await pickExecutor(base, modeLabel);
  console.log(`[1] 选用施工队: ${executorId}`);

  const conversationId = await resolveConversationId(base);
  console.log(`[2] 对话: ${conversationId}`);

  const created = await json(base, "/api/goals", {
    method: "POST",
    body: JSON.stringify({
      conversationId,
      userDraft: "生成浏览器小游戏（需工头选型）",
      title: "E2E-Crew-Game",
      acceptance: "完成工头对话并实现选定方案的小游戏",
      executionPrompt: GAME_PROMPT,
      executorId,
      autoStart: true,
    }),
  });
  const goalId = created.goal.id;
  console.log(`[3] Goal ${goalId} 已派单`);

  console.log("[4] 等待施工队 → 工头 → 施工队 对话…");
  const { question, directive } = await waitForCrewDialogue(base, goalId);
  console.log(`    施工队提问: ${question.summary}`);
  console.log(`    工头指令: ${directive.summary}`);
  const directiveSource = directive.payload?.source;
  if (directiveSource) {
    console.log(`    工头来源: ${directiveSource}`);
  }
  if (directive.payload?.message) {
    console.log(`    工头回复: ${directive.payload.message.slice(0, 120)}`);
  }

  if (directiveSource === "foreman_llm") {
    console.log("    ✓ 工头 LLM 自然语言回复已生效");
  } else if (directive.summary || directive.payload?.message) {
    console.log(`    ✓ 工头已回复（source=${directiveSource ?? "unknown"}）`);
  } else {
    throw new Error(`工头未给出有效回复: ${JSON.stringify(directive.payload)}`);
  }

  console.log("[5] 等待任务完成…");
  const done = await waitForGoal(
    base,
    goalId,
    (g) =>
      g.status === "awaiting_review" ||
      g.status === "done" ||
      g.status === "failed",
    "Crew Game Goal",
  );

  const { logs, run } = await json(base, `/api/goals/${goalId}`);
  const foremanLogs = logs?.filter((l) => /工头|crew|施工队/.test(l.message)) ?? [];
  const llmForemanLog = logs?.find((l) => /工头 LLM 决策/.test(l.message));
  const fallbackLog = logs?.find((l) => /回退规则引擎/.test(l.message));
  console.log(`[6] 结果 status=${done.status} progress=${done.progress}%`);
  if (done.resultSummary) {
    console.log(`    摘要: ${done.resultSummary.slice(0, 200)}`);
  }
  console.log(`    工头相关日志: ${foremanLogs.length} 条`);
  if (llmForemanLog) console.log(`    LLM 工头: ${llmForemanLog.message.slice(0, 120)}`);
  if (fallbackLog) console.log(`    规则回退: ${fallbackLog.message.slice(0, 120)}`);
  console.log(`    Run events: ${run?.events?.length ?? 0}`);

  if (done.status === "failed") {
    const err = logs?.find((l) => l.level === "error");
    throw new Error(`任务失败: ${err?.message ?? done.resultSummary ?? "unknown"}`);
  }

  const { messages } = await json(base, `/api/goals/${goalId}/crew-messages`);
  console.log(`[7] crew-messages 共 ${messages.length} 条`);
  for (const m of messages) {
    console.log(`    - [${m.direction}] ${m.summary.slice(0, 80)}`);
  }

  console.log("\n=== 工头↔施工队 小游戏 E2E 通过 ===\n");
  return { goalId, executorId, messages };
}

async function main() {
  let base = process.env.OPENX_BASE ?? DEFAULT_BASE;
  let mockProc = null;
  let modeLabel = "真实 ACP";

  if (useExistingServer) {
    base = process.env.OPENX_BASE ?? DEFAULT_BASE;
    modeLabel = process.env.OPENX_ACP_MOCK === "1" ? "Mock ACP (external)" : "真实 ACP (external)";
    console.log(`使用已有 server: ${base}`);
  } else if (forceMock || (!forceReal && !process.stdin.isTTY)) {
    modeLabel = "Mock ACP";
    console.log(`启动 Mock server（OPENX_ACP_MOCK=1, PORT=${MOCK_PORT}）…`);
    mockProc = startMockServer();
    base = `http://127.0.0.1:${MOCK_PORT}`;
    process.on("exit", () => mockProc?.kill());
  } else if (!forceReal) {
    try {
      const { executors } = await json(base, "/api/executors");
      const claude = executors.find((e) => e.id === "acp:claude");
      if (!claude?.available) {
        console.log("acp:claude 不可用，回退 Mock 模式…");
        modeLabel = "Mock ACP";
        mockProc = startMockServer();
        base = `http://127.0.0.1:${MOCK_PORT}`;
      }
    } catch {
      console.log("主服务不可达，回退 Mock 模式…");
      modeLabel = "Mock ACP";
      mockProc = startMockServer();
      base = `http://127.0.0.1:${MOCK_PORT}`;
    }
  }

  await waitForHttp(base);
  await runCrewGameE2e(base, modeLabel);
  mockProc?.kill();
}

main().catch((err) => {
  console.error("\nE2E 失败:", err.message);
  process.exit(1);
});
