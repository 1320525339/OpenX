const BASE = "http://127.0.0.1:3921";
const CONV = "7IDYLMXl49-bhsXu41bRi";

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

const { goal } = await api("POST", "/api/goals", {
  conversationId: CONV,
  userDraft: "CC ACP 鉴权 ping",
  title: "CC ACP 鉴权 ping",
  executionPrompt:
    "直接回复一句中文：「CC ACP 鉴权通讯正常」。禁止调用任何工具，禁止执行终端命令，禁止读写文件。",
  executorId: "acp:claude",
  autoStart: true,
});

console.log("goal", goal.id, goal.status);

for (let i = 0; i < 30; i++) {
  const { goal: g, logs } = await api("GET", `/api/goals/${goal.id}`);
  const last = logs[logs.length - 1];
  if (last) console.log(`[${g.status} ${g.progress}%]`, last.message.slice(0, 120));
  if (["awaiting_review", "done", "failed"].includes(g.status)) {
    console.log("\n结果:", g.resultSummary?.slice(0, 400));
    const err = logs.find((l) => l.level === "error");
    if (err) console.log("错误:", err.message.slice(0, 300));
    process.exit(g.status === "failed" ? 1 : 0);
  }
  await new Promise((r) => setTimeout(r, 4000));
}
throw new Error("超时");
