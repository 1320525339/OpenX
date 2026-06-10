const BASE = "http://127.0.0.1:3921";
const results = [];
let parentGoalId = "";
let connId = "";

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, status: "PASS" });
    console.log(`[PASS] ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, status: "FAIL", error: msg });
    console.log(`[FAIL] ${name} — ${msg}`);
  }
}

async function json(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${res.status} ${body.error ?? res.statusText}`);
  }
  return body;
}

console.log("\n=== OpenX API Smoke Test ===\n");

await test("GET /api/health", async () => {
  const r = await json("/api/health");
  if (!r.ok) throw new Error("health not ok");
});

await test("GET /api/settings", async () => {
  const r = await json("/api/settings");
  if (r.autoExecute === undefined) throw new Error("missing settings");
});

await test("GET /api/executors", async () => {
  const r = await json("/api/executors");
  if (!r.executors?.length) throw new Error("no executors");
});

await test("GET /api/coach/status", async () => {
  const r = await json("/api/coach/status");
  if (r.ready === undefined) throw new Error("no coach runtime");
});

await test("GET /api/goals", async () => {
  const r = await json("/api/goals");
  if (!Array.isArray(r.goals)) throw new Error("no goals array");
});

await test("POST /api/coach/chat (directory inspect)", async () => {
  const r = await json("/api/coach/chat", {
    method: "POST",
    body: JSON.stringify({ message: "list files in workspace directory" }),
  });
  if (!r.message) throw new Error("empty message");
  if (!r.refined?.executionPrompt) throw new Error("expected refined");
});

await test("POST /api/goals (with subGoals)", async () => {
  const r = await json("/api/goals", {
    method: "POST",
    body: JSON.stringify({
      userDraft: "smoke test module",
      title: "Smoke-NorthStar",
      acceptance: "sub goals created",
      executionPrompt: "coordinate sub tasks",
      constraints: ["test only"],
      autoStart: false,
      subGoals: [
        {
          userDraft: "create readme placeholder",
          title: "Smoke-Sub-A",
          acceptance: "readme exists",
          executionPrompt: "create README.smoke.md with smoke test content",
        },
        {
          userDraft: "cleanup readme",
          title: "Smoke-Sub-B",
          acceptance: "readme removed",
          executionPrompt: "delete README.smoke.md if exists",
        },
      ],
    }),
  });
  if (!r.goal?.id) throw new Error("no parent goal");
  if (!r.children || r.children.length < 2) throw new Error("expected 2 children");
  parentGoalId = r.goal.id;
});

await test("GET /api/goals/:id/children", async () => {
  if (!parentGoalId) throw new Error("no parent");
  const r = await json(`/api/goals/${parentGoalId}/children`);
  if (r.children.length < 2) throw new Error("children count below 2");
});

await test("POST /api/goals/:id/sub-goals", async () => {
  if (!parentGoalId) throw new Error("no parent");
  const r = await json(`/api/goals/${parentGoalId}/sub-goals`, {
    method: "POST",
    body: JSON.stringify({
      autoStart: false,
      subGoals: [
        {
          userDraft: "append sub task c",
          title: "Smoke-Sub-C",
          acceptance: "logged ok",
          executionPrompt: "print smoke-ok-c to stdout",
        },
      ],
    }),
  });
  if (!r.children?.length) throw new Error("sub-goals not created");
});

await test("POST /api/connect (register)", async () => {
  const r = await json("/api/connect", {
    method: "POST",
    body: JSON.stringify({
      toolName: "smoke-agent",
      agentName: "Smoke Worker",
      executorId: "smoke-worker",
    }),
  });
  if (!r.connectionId) throw new Error("no connectionId");
  connId = r.connectionId;
});

await test("POST /api/connect/:id/heartbeat", async () => {
  if (!connId) throw new Error("no connection");
  const r = await json(`/api/connect/${connId}/heartbeat`, {
    method: "POST",
    body: JSON.stringify({ connectionId: connId }),
  });
  if (r.status !== "alive") throw new Error("heartbeat failed");
});

await test("GET /api/coach/messages", async () => {
  const r = await json("/api/coach/messages");
  if (!Array.isArray(r.messages)) throw new Error("no messages");
});

const passed = results.filter((r) => r.status === "PASS").length;
const failed = results.filter((r) => r.status === "FAIL").length;
console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===\n`);
for (const r of results.filter((x) => x.status === "FAIL")) {
  console.log(`  - ${r.name}: ${r.error}`);
}
process.exit(failed > 0 ? 1 : 0);
