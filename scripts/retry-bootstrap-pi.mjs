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

// 提高 Pi 工具上限，避免自举验收被截断
const settings = await api("GET", "/api/settings");
if ((settings.executors?.pi?.maxToolCalls ?? 12) < 24) {
  await api("PUT", "/api/settings", {
    ...settings,
    executors: {
      ...settings.executors,
      pi: { ...settings.executors?.pi, maxToolCalls: 24 },
    },
  });
  console.log("maxToolCalls → 24");
}

const { goal } = await api("POST", "/api/goals", {
  conversationId: CONV,
  userDraft: [
    "OpenX 自举验收 v2（一次 bash 完成）",
    "",
    "执行一条命令即可：",
    'node -e "fetch(\'http://127.0.0.1:3921/api/catalog\').then(r=>r.json()).then(j=>console.log(JSON.stringify({endpointCount:j.meta.endpointCount,mcp:j.meta.mcpServerId,ok:true})))"',
    "",
    "将 stdout JSON 作为最终结果汇报，不要多次调用工具。",
  ].join("\n"),
  executorId: "pi",
  autoStart: true,
});

console.log("goal", goal.id, goal.status);
