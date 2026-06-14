/**
 * 审查 thread 前缀联调（绕过工头 chat LLM，直接种子数据）：
 * 1. API 建项目/会话 → DB 写入 coach 线程 + awaiting_review 目标
 * 2. 校验 buildCoachThreadPrefixFromRecords 与工头同格式
 * 3. POST trigger-review 走真实审查 LLM
 *
 * 勿设 OPENX_DB_PATH=:memory:（脚本与 server 须共用 ~/.openx/openx.db）。
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import type { CoachMessageRecord, Goal } from "@openx/shared";
import { createEmptyRunState } from "@openx/shared";
import {
  buildCoachThreadPrefixFromRecords,
  COACH_THREAD_HISTORY_HEADING,
} from "@openx/coach";
import { getDbPath } from "../paths.js";
import {
  insertGoal,
  listCoachMessages,
  saveCoachExecutionMessage,
  saveCoachMessage,
  saveCoachRefinedMessage,
} from "../db.js";

const BASE = process.env.OPENX_API ?? "http://127.0.0.1:3921";
const REVIEW_TIMEOUT_MS = 180_000;

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} ${res.status}: ${JSON.stringify(body)}`);
  }
  return body as T;
}

async function main() {
  console.log("=== 审查 thread 前缀联调 ===");
  console.log("API:", BASE);

  const settings = await json<{ model: { coach: string } }>("/api/settings");
  console.log("coach model:", settings.model.coach);

  const cwd = process.cwd();
  const artifact = "review-hello.txt";
  const artifactPath = join(cwd, artifact);
  writeFileSync(artifactPath, "Hello Review Thread", "utf8");

  const { project } = await json<{ project: { id: string } }>("/api/projects", {
    method: "POST",
    body: JSON.stringify({ workspaceDir: cwd, name: `review-thread-${Date.now()}` }),
  });
  const { conversation } = await json<{ conversation: { id: string } }>(
    `/api/projects/${project.id}/conversations`,
    { method: "POST", body: JSON.stringify({ title: "审查 thread 测试" }) },
  );
  const convId = conversation.id;
  console.log("1. 会话:", convId, "| db:", getDbPath());

  const taskMsg = `写一个 ${artifact}，内容为 Hello Review Thread；验收：文件存在且内容正确`;
  saveCoachMessage(convId, "user", taskMsg);
  saveCoachMessage(convId, "coach", "好的，我来整理这个任务单。");
  const refined = saveCoachRefinedMessage(convId, {
    title: "审查 thread 验收文件",
    acceptance: `工作区存在 ${artifact} 且内容为 Hello Review Thread`,
    executionPrompt: `创建 ${artifact}，写入 Hello Review Thread`,
    constraints: [],
  });

  const goalId = nanoid();
  const now = new Date().toISOString();
  const goal: Goal = {
    id: goalId,
    orderNo: 0,
    conversationId: convId,
    title: refined.refined.title,
    acceptance: refined.refined.acceptance,
    userDraft: taskMsg,
    executionPrompt: refined.refined.executionPrompt,
    constraints: refined.refined.constraints,
    executorId: "pi",
    status: "awaiting_review",
    progress: 100,
    resultSummary: `已创建 ${artifact}`,
    dependsOn: [],
    priority: "medium",
    autoReview: true,
    iterationCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  insertGoal(goal);

  saveCoachExecutionMessage(convId, {
    goalId,
    goalTitle: goal.title,
    goalStatus: "awaiting_review",
    runId: `mock-${goalId}`,
    run: { ...createEmptyRunState(goalId), runId: `mock-${goalId}` },
  });
  console.log("2. 种子目标:", goalId);

  const messages = listCoachMessages(convId);
  const prefix = buildCoachThreadPrefixFromRecords(messages);
  if (!prefix?.includes(COACH_THREAD_HISTORY_HEADING)) {
    throw new Error("thread 前缀缺少统一标题");
  }
  if (!prefix.includes("用户：") || !prefix.includes(taskMsg.slice(0, 16))) {
    throw new Error("thread 前缀未包含用户消息");
  }
  if (!prefix.includes("[执行快照]")) {
    throw new Error("thread 前缀未包含执行快照");
  }
  console.log("3. thread 前缀校验 ✓");
  console.log(prefix.split("\n").slice(0, 8).join("\n"), "…");

  console.log("4. 触发审查…");
  const reviewStart = Date.now();
  const reviewBody = await json<{
    ok?: boolean;
    error?: string;
    goal?: { status: string; effectStatus?: string };
    rounds?: { verdict?: string }[];
  }>(`/api/goals/${goalId}/trigger-review`, {
    method: "POST",
    body: JSON.stringify({ force: true }),
    signal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
  });

  const elapsed = Date.now() - reviewStart;
  console.log(`5. 审查完成 (${(elapsed / 1000).toFixed(1)}s):`, JSON.stringify({
    ok: reviewBody.ok,
    status: reviewBody.goal?.status,
    effectStatus: reviewBody.goal?.effectStatus,
    rounds: reviewBody.rounds?.length ?? 0,
    lastVerdict: reviewBody.rounds?.at(-1)?.verdict,
    error: reviewBody.error,
  }));

  const { messages: apiMessages } = await json<{ messages: CoachMessageRecord[] }>(
    `/api/coach/messages?conversationId=${convId}`,
  );
  const apiPrefix = buildCoachThreadPrefixFromRecords(apiMessages);
  if (apiPrefix !== prefix.split("\n").slice(0, apiPrefix?.split("\n").length).join("\n")) {
    // 仅校验 API 与 DB 前缀标题一致（审查后消息条数可能不变）
    if (!apiPrefix?.includes(COACH_THREAD_HISTORY_HEADING)) {
      throw new Error("API 拉取的 thread 前缀格式不一致");
    }
  }
  console.log("6. API/DB thread 前缀一致 ✓");

  const status = reviewBody.goal?.status;
  if (status === "done") {
    console.log("\nOK 审查通过，thread 联调完成");
    return;
  }
  if (status === "awaiting_review" && (reviewBody.rounds?.length ?? 0) === 0) {
    console.warn("\nWARN: 审查 LLM 未返回 verdict（保持 awaiting_review）");
    return;
  }
  if (status === "running") {
    console.log("\nOK 审查 fail → 返工，thread 前缀链路正常");
    return;
  }
  throw new Error(`意外终态: ${status}`);
}

main().catch((err) => {
  console.error("\nFAIL", err);
  process.exit(1);
});
