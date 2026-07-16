#!/usr/bin/env node
/**
 * Optional: create-task live write smoke — creates a disposable reminder then deletes it.
 * Requires real Pi + WSL Miloco. Set MILOCO_CREATE_TASK_SMOKE_CONFIRM=1 to run.
 */

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.OPENX_API_BASE ?? process.env.OPENX_BASE_URL ?? "http://127.0.0.1:3921";

if (process.env.MILOCO_CREATE_TASK_SMOKE_CONFIRM !== "1") {
  console.log("Set MILOCO_CREATE_TASK_SMOKE_CONFIRM=1 to run create-task live smoke.");
  process.exit(0);
}

function runWsl(args) {
  const ps1 = join(ROOT, "scripts", "miloco-wsl.ps1");
  return spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, ...args],
    { encoding: "utf8", cwd: ROOT },
  );
}

async function main() {
  const projects = await (await fetch(`${BASE}/api/projects`)).json();
  const projectId = projects.projects?.[0]?.id;
  const conv = await (
    await fetch(`${BASE}/api/projects/${projectId}/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "create-task smoke" }),
    })
  ).json();

  const goalRes = await fetch(`${BASE}/api/goals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      conversationId: conv.conversation.id,
      userDraft: "创建一个 1 分钟后触发的测试提醒，任务名 openx-smoke-test，创建后立即 terminate",
      title: "Miloco create-task live smoke",
      acceptance: "已创建并删除 openx-smoke-test 任务",
      executionPrompt:
        "使用 miloco-create-task 创建一次性测试提醒 openx-smoke-test，验证后使用 miloco-terminate-task 删除。",
      executorId: "pi",
      autoStart: true,
      refinedMessageId: 1,
      dispatchContext: {
        skillIds: ["miloco-create-task", "miloco-terminate-task"],
      },
    }),
  });
  const goal = (await goalRes.json()).goal;
  console.log(`Goal ${goal.id} created — monitor in OpenX UI`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
