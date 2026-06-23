/**
 * 任务单生命周期 API 冒烟：创建 refined → 取消 skipRefine → 确认不再出 refined
 */
const BASE = process.env.OPENX_API ?? "http://127.0.0.1:3921";

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

type CoachMessage = {
  kind: string;
  id?: number;
  role?: string;
  text?: string;
  refined?: { title: string };
};

function refinedCount(messages: CoachMessage[]) {
  return messages.filter((m) => m.kind === "refined").length;
}

async function listMessages(conversationId: string): Promise<CoachMessage[]> {
  const { messages } = await json<{ messages: CoachMessage[] }>(
    `/api/coach/messages?conversationId=${conversationId}`,
  );
  return messages;
}

async function main() {
  const cwd = process.cwd();
  const { project } = await json<{ project: { id: string } }>("/api/projects", {
    method: "POST",
    body: JSON.stringify({ workspaceDir: cwd, name: `flow-${Date.now()}` }),
  });
  const { conversation } = await json<{ conversation: { id: string } }>(
    `/api/projects/${project.id}/conversations`,
    { method: "POST", body: JSON.stringify({ title: "任务单流程" }) },
  );
  const convId = conversation.id;
  console.log("conversation:", convId);

  const taskMsg = "帮我实现一个用户登录 API，验收标准是接口返回 200";
  const createReply = await json<{
    refined?: { title: string };
    message: string;
  }>("/api/coach/chat", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, message: taskMsg }),
  });
  console.log("create intent:", createReply.refined?.title ?? "(no refined)");

  let messages = await listMessages(convId);
  const beforeCancel = refinedCount(messages);
  console.log("refined count after task:", beforeCancel);
  if (beforeCancel < 1) {
    throw new Error("expected at least one refined record after task message");
  }

  const refinedId = messages.find((m) => m.kind === "refined")?.id;
  if (!refinedId) throw new Error("missing refined message id");

  const cancelReply = await json<{ refined?: unknown; message: string }>(
    `/api/coach/refined/${refinedId}/respond`,
    {
      method: "POST",
      body: JSON.stringify({
        conversationId: convId,
        outcome: "dismissed",
      }),
    },
  );
  if (cancelReply.refined) {
    throw new Error("cancel should not return refined");
  }
  console.log("cancel coach:", cancelReply.message.slice(0, 60));

  messages = await listMessages(convId);
  const cancelUserMsgs = messages.filter(
    (m) =>
      m.kind === "text" &&
      m.role === "user" &&
      /先不创建|任务单了/.test(m.text ?? ""),
  );
  if (cancelUserMsgs.length > 0) {
    throw new Error("cancel should not create fake user dismiss messages");
  }
  const toolResults = messages.filter((m) => m.kind === "tool_result");
  if (toolResults.length < 1) {
    throw new Error("expected tool_result after cancel");
  }
  const afterCancel = refinedCount(messages);
  if (afterCancel !== beforeCancel) {
    throw new Error(`refined count changed after cancel: ${beforeCancel} -> ${afterCancel}`);
  }
  console.log("refined count stable after cancel:", afterCancel);

  const followUp = await json<{ refined?: unknown }>("/api/coach/chat", {
    method: "POST",
    body: JSON.stringify({
      conversationId: convId,
      message: "好的，谢谢",
    }),
  });
  if (followUp.refined) {
    throw new Error("chitchat follow-up should not return refined");
  }
  messages = await listMessages(convId);
  console.log("final refined count:", refinedCount(messages));
  console.log("OK work-order flow");
}

main().catch((e) => {
  console.error("FLOW FAIL:", e);
  process.exit(1);
});
