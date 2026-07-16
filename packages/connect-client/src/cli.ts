#!/usr/bin/env node
/**
 * OpenX Connect Agent：注册 → 心跳拉取 → LLM 执行 → 回调 complete
 */

import type { RunDeltaEvent, Settings } from "@openx/shared";
import type { ExecutionSkillHint } from "@openx/shared";
import { executeWithLlm } from "./llm.js";
import { RunEventPoster } from "./run-events.js";
import {
  buildConnectSkillsSystem,
  resolveConnectSkills,
  type SkillsApiResponse,
} from "./skills.js";

const DEFAULT_BASE = "http://127.0.0.1:3921";
const HEARTBEAT_MS = 3000;

type Goal = {
  id: string;
  title: string;
  acceptance: string;
  executionPrompt: string;
  executorId: string;
  status: string;
};

type PendingWorkItem = {
  goal: Goal;
  receiptId?: string;
  runId?: string;
};

type HeartbeatResponse = {
  pendingGoals?: Array<Goal | PendingWorkItem>;
  skillsDir?: string;
  enabledSkills?: ExecutionSkillHint[];
};

type SkillsRuntime = {
  hints: ExecutionSkillHint[];
  skillsDir: string;
};

type ConnectResponse = {
  connectionId: string;
  executorId: string;
  heartbeatUrl: string;
  skillsDir?: string;
  internalToken: string;
  callbacks: {
    progress: string;
    complete: string;
    fail: string;
    log: string;
    runEvent: string;
    ackReceipt?: string;
  };
};

function normalizePendingItem(item: Goal | PendingWorkItem): PendingWorkItem {
  if ("goal" in item && item.goal) return item;
  return { goal: item as Goal };
}

function parseArgs(argv: string[]) {
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        opts[key] = next;
        i += 1;
      } else {
        opts[key] = "true";
      }
    }
  }
  return {
    base: opts.base ?? DEFAULT_BASE,
    toolName: opts["tool-name"] ?? "openx-connect-demo",
    agentName: opts["agent-name"] ?? "Connect Demo Agent",
    executorId: opts["executor-id"] ?? opts["tool-name"] ?? "connect-demo",
    mock: opts.mock === "true",
  };
}

function fillGoalId(urlTemplate: string, goalId: string): string {
  return urlTemplate.replace("{goalId}", goalId);
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${url} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function postJson(url: string, body: unknown, internalToken?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (internalToken) {
    headers["x-openx-internal-token"] = internalToken;
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`${url} → ${res.status}: ${text}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return res.json();
}

async function registerConnect(args: {
  base: string;
  toolName: string;
  agentName: string;
  executorId: string;
}): Promise<ConnectResponse> {
  return (await postJson(`${args.base}/api/connect`, {
    toolName: args.toolName,
    agentName: args.agentName,
    executorId: args.executorId,
  })) as ConnectResponse;
}

async function loadSkillsRuntime(base: string, executorId: string): Promise<SkillsRuntime | null> {
  try {
    const data = await getJson<SkillsApiResponse>(`${base}/api/skills`);
    return {
      hints: resolveConnectSkills(executorId, data),
      skillsDir: data.skillsDir,
    };
  } catch (err) {
    console.warn("[connect-client] 无法加载 Skills:", err);
    return null;
  }
}

async function executeGoal(
  work: PendingWorkItem,
  callbacks: ConnectResponse["callbacks"],
  internalToken: string,
  settings: Settings | null,
  mock: boolean,
  skillsRuntime: SkillsRuntime | null,
) {
  const goal = work.goal;
  const progressUrl = fillGoalId(callbacks.progress, goal.id);
  const completeUrl = fillGoalId(callbacks.complete, goal.id);
  const logUrl = fillGoalId(callbacks.log, goal.id);
  const runEventUrl = fillGoalId(callbacks.runEvent, goal.id);

  const postInternal = (url: string, body: unknown) => postJson(url, body, internalToken);
  const postRunEvent = (event: RunDeltaEvent) => postInternal(runEventUrl, event);

  if (work.receiptId && callbacks.ackReceipt) {
    await postInternal(callbacks.ackReceipt, { receiptId: work.receiptId }).catch((err) => {
      console.warn("[connect-client] receipt ACK 失败:", err);
    });
  }

  console.log(`[connect-client] 执行任务 ${goal.id}: ${goal.title}`);
  await postInternal(logUrl, { level: "info", message: `[connect-client] 开始处理：${goal.title}` });
  await postInternal(progressUrl, { progress: 15, message: "Connect Agent 已认领任务…" });

  let summary: string;
  let tokenUsage:
    | { model?: string; inputTokens?: number; outputTokens?: number }
    | undefined;
  if (mock || !settings) {
    await postInternal(logUrl, { level: "warn", message: "[connect-client] 演示模式（未使用 LLM）" });
    await postInternal(progressUrl, { progress: 60, message: "演示模式整理结果…" });
    summary = [
      `Connect Demo 已完成任务「${goal.title}」`,
      "",
      goal.executionPrompt.slice(0, 800),
    ].join("\n");
    await postRunEvent({
      type: "text.delta",
      delta: summary,
      timestamp: new Date().toISOString(),
    });
  } else {
    const runPoster = new RunEventPoster((event) => postRunEvent(event));
    const skillsSystem = skillsRuntime
      ? buildConnectSkillsSystem(skillsRuntime.hints, skillsRuntime.skillsDir)
      : undefined;
    if (skillsSystem) {
      await postInternal(logUrl, {
        level: "info",
        message: `[connect-client] 已加载 ${skillsRuntime!.hints.length} 个 Skill`,
      });
    }
    await postInternal(logUrl, { level: "info", message: "[connect-client] 调用 OpenX Pi 执行模型…" });
    await postInternal(progressUrl, { progress: 35, message: "LLM 执行中…" });
    await runPoster.status("Connect Agent 调用 LLM…");
    summary = await executeWithLlm(
      settings,
      goal,
      (delta) => runPoster.textDelta(delta),
      skillsSystem,
    );
    await runPoster.finish();
    await postInternal(progressUrl, { progress: 90, message: "LLM 完成，提交结果…" });
    tokenUsage = {
      model: settings.model?.pi ?? settings.model?.default,
      inputTokens: Math.ceil((goal.executionPrompt.length + summary.length) / 4),
      outputTokens: Math.ceil(summary.length / 4),
    };
  }

  await postInternal(completeUrl, { resultSummary: summary });
  console.log(`[connect-client] 已完成 ${goal.id}`);
  return {
    tokenUsage: tokenUsage
      ? {
          ...tokenUsage,
          goalId: goal.id,
          runId: work.runId,
        }
      : undefined,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[connect-client] 连接 ${args.base} executorId=${args.executorId}`);

  let settings: Settings | null = null;
  try {
    settings = await getJson<Settings>(`${args.base}/api/settings`);
    console.log("[connect-client] 已加载 OpenX 模型配置");
  } catch (err) {
    console.warn("[connect-client] 无法加载 settings，将使用演示模式:", err);
  }

  let conn = await registerConnect(args);

  console.log(`[connect-client] 已注册 connectionId=${conn.connectionId}`);

  let skillsRuntime = await loadSkillsRuntime(args.base, args.executorId);
  if (conn.skillsDir && skillsRuntime) {
    skillsRuntime = { ...skillsRuntime, skillsDir: conn.skillsDir };
  } else if (conn.skillsDir && !skillsRuntime) {
    skillsRuntime = { hints: [], skillsDir: conn.skillsDir };
  }

  const inFlight = new Set<string>();
  let pendingTokenUsage:
    | {
        model?: string;
        inputTokens?: number;
        outputTokens?: number;
        goalId?: string;
        runId?: string;
      }
    | undefined;

  const tick = async () => {
    let res: HeartbeatResponse;
    const heartbeatBody: Record<string, unknown> = {
      connectionId: conn.connectionId,
    };
    if (pendingTokenUsage) {
      heartbeatBody.tokenUsage = pendingTokenUsage;
      pendingTokenUsage = undefined;
    }
    try {
      res = (await postJson(conn.heartbeatUrl, heartbeatBody)) as HeartbeatResponse;
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status !== 404) throw err;
      console.warn("[connect-client] 连接已失效（服务端可能重启），正在重新注册…");
      conn = await registerConnect(args);
      console.log(`[connect-client] 已重新注册 connectionId=${conn.connectionId}`);
      res = (await postJson(conn.heartbeatUrl, {
        connectionId: conn.connectionId,
      })) as HeartbeatResponse;
    }

    if (res.enabledSkills) {
      skillsRuntime = {
        hints: res.enabledSkills,
        skillsDir: res.skillsDir ?? skillsRuntime?.skillsDir ?? "",
      };
    }

    for (const raw of res.pendingGoals ?? []) {
      const work = normalizePendingItem(raw);
      if (inFlight.has(work.goal.id)) continue;
      inFlight.add(work.goal.id);
      void executeGoal(work, conn.callbacks, conn.internalToken, settings, args.mock, skillsRuntime)
        .then((result) => {
          if (result?.tokenUsage) pendingTokenUsage = result.tokenUsage;
        })
        .catch(async (err) => {
          const failUrl = fillGoalId(conn.callbacks.fail, work.goal.id);
          await postJson(failUrl, {
            errorMessage: err instanceof Error ? err.message : String(err),
          }, conn.internalToken).catch(() => {});
        })
        .finally(() => {
          inFlight.delete(work.goal.id);
        });
    }
  };

  await tick();
  setInterval(() => {
    void tick().catch((err) => {
      console.error("[connect-client] heartbeat error:", err);
    });
  }, HEARTBEAT_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
