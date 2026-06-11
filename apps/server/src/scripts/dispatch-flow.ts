/**
 * 派单完整流程 API 冒烟：
 * 对话出任务单 → 创建并执行 → Mock 执行器跑完 → 待验收 → 批准 → 完成
 *
 * 需 OPENX_MOCK_PI=1 启动 server（确定性 mock 执行器，秒级完成）
 */
const BASE = process.env.OPENX_API ?? "http://127.0.0.1:3921";
const POLL_MS = 400;
const RUN_TIMEOUT_MS = 45_000;

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

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForGoalStatus(
  goalId: string,
  want: string | string[],
  timeoutMs = RUN_TIMEOUT_MS,
) {
  const targets = Array.isArray(want) ? want : [want];
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { goal } = await json<{ goal: { status: string; resultSummary?: string } }>(
      `/api/goals/${goalId}`,
    );
    if (targets.includes(goal.status)) return goal;
    if (goal.status === "failed" || goal.status === "cancelled") {
      const { logs } = await json<{ logs: { level: string; message: string }[] }>(
        `/api/goals/${goalId}`,
      );
      const tail = logs.slice(-5).map((l) => `[${l.level}] ${l.message}`).join("\n");
      throw new Error(`goal ${goalId} ended as ${goal.status}\n${tail}`);
    }
    await sleep(POLL_MS);
  }
  throw new Error(`timeout waiting for ${targets.join("|")} on goal ${goalId}`);
}

type CoachMsg = {
  kind: string;
  id?: number;
  role?: string;
  linkedGoalId?: string;
  refined?: { title: string };
};

async function main() {
  console.log("=== 派单完整流程测试 ===");
  console.log("API:", BASE);

  const cwd = process.cwd();
  const { project } = await json<{ project: { id: string } }>("/api/projects", {
    method: "POST",
    body: JSON.stringify({ workspaceDir: cwd, name: `dispatch-${Date.now()}` }),
  });
  const { conversation } = await json<{ conversation: { id: string } }>(
    `/api/projects/${project.id}/conversations`,
    { method: "POST", body: JSON.stringify({ title: "派单流程测试" }) },
  );
  const convId = conversation.id;
  console.log("1. 会话:", convId);

  const taskMsg = "写一个 hello.txt 文件，验收：文件存在且内容为 Hello OpenX";
  const chatReply = await json<{
    refined?: {
      title: string;
      acceptance: string;
      executionPrompt: string;
      constraints: string[];
    };
    message: string;
  }>("/api/coach/chat", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, message: taskMsg }),
  });
  if (!chatReply.refined) {
    throw new Error(`coach 未产出任务单: ${chatReply.message.slice(0, 80)}`);
  }
  console.log("2. 任务单:", chatReply.refined.title);

  const { messages } = await json<{ messages: CoachMsg[] }>(
    `/api/coach/messages?conversationId=${convId}`,
  );
  const refinedRow = [...messages].reverse().find((m) => m.kind === "refined");
  if (!refinedRow?.id) throw new Error("未找到 persisted refined 记录");

  const { goal } = await json<{ goal: { id: string; status: string; executorId: string } }>(
    "/api/goals",
    {
      method: "POST",
      body: JSON.stringify({
        conversationId: convId,
        userDraft: taskMsg,
        executorId: "pi",
        title: chatReply.refined.title,
        acceptance: chatReply.refined.acceptance,
        executionPrompt: chatReply.refined.executionPrompt,
        constraints: chatReply.refined.constraints,
        refinedMessageId: refinedRow.id,
        autoStart: true,
      }),
    },
  );
  console.log("3. 创建并派单:", goal.id, "executor:", goal.executorId);

  const reviewed = await waitForGoalStatus(goal.id, "awaiting_review");
  console.log("4. 执行完成，待验收:", reviewed.resultSummary?.slice(0, 60) ?? "(无摘要)");

  await json(`/api/goals/${goal.id}/approve`, { method: "POST", body: "{}" });
  const done = await waitForGoalStatus(goal.id, "done", 10_000);
  console.log("5. 已批准，状态:", done.status);

  const { messages: after } = await json<{ messages: CoachMsg[] }>(
    `/api/coach/messages?conversationId=${convId}`,
  );
  const linked = after.find(
    (m) => m.kind === "refined" && m.id === refinedRow.id && m.linkedGoalId === goal.id,
  );
  if (!linked) {
    throw new Error("refined 记录未关联 goalId（任务芯片链路断裂）");
  }
  const hasExecution = after.some((m) => m.kind === "execution");
  if (!hasExecution) {
    console.warn("WARN: 对话流暂无 execution 快照（可能尚未写入 coach 线程）");
  } else {
    console.log("6. 对话流含 execution 快照 ✓");
  }

  const { logs } = await json<{ logs: { message: string }[] }>(`/api/goals/${goal.id}`);
  const ranMock = logs.some((l) => /mock|Mock|测试执行器/.test(l.message));
  if (!ranMock) {
    console.warn("WARN: 日志未检测到 Mock 执行器（请用 OPENX_MOCK_PI=1 启动 server）");
  } else {
    console.log("7. Mock 执行器日志 ✓");
  }

  console.log("\nOK 派单完整流程通过");
  console.log(JSON.stringify({ conversationId: convId, goalId: goal.id, projectId: project.id }, null, 2));
}

main().catch((e) => {
  console.error("\nDISPATCH FLOW FAIL:", e);
  process.exit(1);
});
