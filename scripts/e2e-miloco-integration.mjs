#!/usr/bin/env node

/**

 * Miloco × OpenX 冒烟测试（不依赖 Pi LLM）

 * - API 健康检查

 * - Miloco setup/status

 * - Skills 目录与绑定（含主动闭环 Skills）

 * - Webhook agent turn / get_trace / 鉴权

 * - WSL miloco-cli 包装脚本存在性

 *

 * 建议以 OPENX_MOCK_PI=1 启动 OpenX server 后运行本脚本。

 */



import { existsSync, readFileSync } from "node:fs";

import { join, resolve, dirname } from "node:path";

import { fileURLToPath } from "node:url";

import { homedir } from "node:os";



const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const BASE = process.env.OPENX_API_BASE ?? "http://127.0.0.1:3921";



const PROACTIVE_SKILLS = [

  "miloco-devices",

  "miloco-miot-scope",

  "miloco-miot-admin",

  "miloco-notify",

  "miloco-perception",

];

const BATCH2_SKILLS = [

  "miloco-create-task",

  "miloco-terminate-task",

  "miloco-miot-identity",

  "miloco-miot-identity-register",

];

const BATCH3_SKILLS = [

  "miloco-home-profile",

  "miloco-perception-digest",

  "miloco-home-patrol",

  "miloco-home-observe",

  "miloco-home-promote",

  "miloco-home-prune",

  "miloco-habit-suggest",

];

const SYNC_SKILLS = [...PROACTIVE_SKILLS, ...BATCH2_SKILLS, ...BATCH3_SKILLS];



let failed = 0;



function ok(msg) {

  console.log(`✓ ${msg}`);

}



function fail(msg) {

  console.error(`✗ ${msg}`);

  failed += 1;

}



async function get(path, headers = {}) {

  const res = await fetch(`${BASE}${path}`, { headers });

  const text = await res.text();

  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text}`);

  return JSON.parse(text);

}



async function post(path, body, headers = {}) {

  const res = await fetch(`${BASE}${path}`, {

    method: "POST",

    headers: { "content-type": "application/json", ...headers },

    body: JSON.stringify(body ?? {}),

  });

  const text = await res.text();

  let data;

  try {

    data = JSON.parse(text);

  } catch {

    data = { raw: text };

  }

  return { status: res.status, data, text };

}



function readWebhookToken() {

  const tokenPath = join(homedir(), ".openx", "miloco-webhook.token");

  if (!existsSync(tokenPath)) return null;

  return readFileSync(tokenPath, "utf8").trim() || null;

}



async function main() {

  const wrapper = join(ROOT, "scripts", "miloco-wsl.ps1");

  if (existsSync(wrapper)) ok("miloco-wsl.ps1 存在");

  else fail("miloco-wsl.ps1 缺失");



  const connectScript = join(ROOT, "scripts", "miloco-connect-wsl.ps1");

  if (existsSync(connectScript)) ok("miloco-connect-wsl.ps1 存在");

  else fail("miloco-connect-wsl.ps1 缺失");



  try {

    const health = await get("/api/health");

    if (health.ok) ok("OpenX /api/health");

    else fail("OpenX health 异常");

  } catch (err) {

    fail(`OpenX 未启动: ${err instanceof Error ? err.message : err}`);

    process.exit(1);

  }



  const setup = await post("/api/miloco/setup", { force: false });

  if (setup.status === 200 && setup.data.ok) {

    ok(`Miloco setup: ${setup.data.installed?.join(", ") || "已是最新"}`);

  } else {

    fail(`Miloco setup 失败: ${setup.data.error ?? setup.text}`);

  }



  const status = await get("/api/miloco/status");

  if (status.skillsInstalled?.length >= 1) {

    ok(`Skills 已安装: ${status.skillsInstalled.join(", ")}`);

  } else {

    fail("无已安装的 Miloco Skills");

  }



  if (status.skillsBoundToPi?.length >= 1) {

    ok(`Skills 已绑定 pi: ${status.skillsBoundToPi.join(", ")}`);

  } else {

    fail("Miloco Skills 未绑定 pi");

  }

  const syncInstalled = status.syncSkillsInstalled ?? status.skillsInstalled ?? [];
  if (syncInstalled.length >= SYNC_SKILLS.length) {
    ok(`Sync skills 已安装 (${syncInstalled.length})`);
  } else {
    fail(`Sync skills 不足: 期望 ${SYNC_SKILLS.length}，实际 ${syncInstalled.length}`);
  }

  const batch2Installed = status.batch2SkillsInstalled ?? [];
  if (batch2Installed.length >= BATCH2_SKILLS.length) {
    ok(`Batch2 skills 已安装: ${batch2Installed.join(", ")}`);
  } else {
    fail(`Batch2 skills 不足: 期望 ${BATCH2_SKILLS.length}，实际 ${batch2Installed.length}`);
  }

  const batch2Bound = status.batch2SkillsBoundToPi ?? [];
  if (batch2Bound.length >= BATCH2_SKILLS.length) {
    ok(`Batch2 skills 已绑定 pi: ${batch2Bound.join(", ")}`);
  } else {
    fail(`Batch2 skills 未全部绑定 pi`);
  }

  const batch3Installed = status.batch3SkillsInstalled ?? [];
  if (batch3Installed.length >= BATCH3_SKILLS.length) {
    ok(`Batch3 skills 已安装: ${batch3Installed.length}`);
  } else {
    fail(`Batch3 skills 不足: 期望 ${BATCH3_SKILLS.length}，实际 ${batch3Installed.length}`);
  }

  const batch3Bound = status.batch3SkillsBoundToPi ?? [];
  if (batch3Bound.length >= BATCH3_SKILLS.length) {
    ok(`Batch3 skills 已绑定 pi`);
  } else {
    fail(`Batch3 skills 未全部绑定 pi`);
  }



  if (status.webhook?.tokenConfigured) {

    ok("Webhook token 已配置");

  } else {

    fail("Webhook token 未配置");

  }



  if (status.webhook?.url?.includes("/api/miloco/webhook")) {

    ok(`Webhook URL: ${status.webhook.url}`);

  } else {

    fail("Webhook URL 缺失");

  }



  const skillsDir = join(homedir(), ".openx", "skills");

  for (const id of SYNC_SKILLS) {

    const md = join(skillsDir, id, "SKILL.md");

    if (existsSync(md)) ok(`本地 Skill: ${id}`);

    else fail(`本地 Skill 缺失: ${id}`);

  }



  const skills = await get("/api/skills");

  const catalogIds = new Set(skills.skills.map((s) => s.id));

  for (const id of SYNC_SKILLS) {

    if (catalogIds.has(id)) ok(`目录含 ${id}`);

    else fail(`Skill 目录缺少 ${id}`);

  }



  const adapted = join(skillsDir, "miloco-devices", "SKILL.md");

  if (existsSync(adapted)) {

    const body = readFileSync(adapted, "utf8");

    if (body.includes("miloco-wsl.ps1") && body.includes("OpenX 执行约定")) {

      ok("miloco-devices SKILL 已 OpenX 适配");

    } else {

      fail("miloco-devices SKILL 缺少 OpenX 适配块");

    }

  }



  try {

    const wf = await post("/api/operator/workflows/miloco_health_check/run", {});

    if (wf.status === 200 && wf.data.ok) ok("Workflow miloco_health_check");

    else fail(`Workflow 失败: ${JSON.stringify(wf.data.steps)}`);

  } catch (err) {

    fail(`Workflow: ${err instanceof Error ? err.message : err}`);

  }



  const bindings = skills.bindings ?? {};

  if (bindings["miloco-devices"]?.enabled && bindings["miloco-devices"]?.cliIds?.includes("pi")) {

    ok("config skillBindings 已绑定 miloco-devices → pi");

  } else {

    fail("miloco-devices 未在 bindings 中启用给 pi");

  }



  if (bindings["miloco-notify"]?.enabled && bindings["miloco-notify"]?.cliIds?.includes("pi")) {

    ok("config skillBindings 已绑定 miloco-notify → pi");

  } else {

    fail("miloco-notify 未在 bindings 中启用给 pi");

  }

  if (bindings["miloco-create-task"]?.enabled && bindings["miloco-create-task"]?.cliIds?.includes("pi")) {

    ok("config skillBindings 已绑定 miloco-create-task → pi");

  } else {

    fail("miloco-create-task 未在 bindings 中启用给 pi");

  }



  // Webhook tests

  const webhookHealth = await get("/api/miloco/webhook");

  if (webhookHealth.ok && webhookHealth.service === "miloco-webhook") {

    ok("GET /api/miloco/webhook 健康探针");

  } else {

    fail("Webhook 健康探针异常");

  }



  const badAuth = await post(

    "/api/miloco/webhook",

    { action: "agent", payload: { message: "test" } },

    { authorization: "Bearer invalid-token" },

  );

  if (badAuth.status === 401 && badAuth.data.code === 401) {

    ok("Webhook 错误 token 返回 401");

  } else {

    fail(`Webhook 鉴权失败用例异常: ${badAuth.status} ${badAuth.text}`);

  }



  const token = readWebhookToken();

  if (!token) {

    fail("无法读取 ~/.openx/miloco-webhook.token，跳过 webhook turn 测试");

  } else {

    const traceId = `e2e-${Date.now()}`;

    const turn = await post(

      "/api/miloco/webhook",

      {

        action: "agent",

        payload: {

          message: "[感知引擎]事件提醒：\n来源：客厅的小米C700\n检测到：室内高温\n建议：建议开空调",

          sessionKey: "agent:main:miloco-suggest",

          lane: "miloco-suggest",

          traceId,

          idempotencyKey: traceId,

          timeoutMs: 30_000,

        },

      },

      { authorization: `Bearer ${token}` },

    );



    if (turn.status === 200 && turn.data.code === 0 && turn.data.data?.runId) {

      ok(`Webhook agent turn: runId=${turn.data.data.runId} status=${turn.data.data.status}`);

      if (turn.data.data.status === "ok") {

        ok("Webhook turn 返回 status=ok");

      } else {

        fail(`Webhook turn status 非 ok: ${turn.data.data.status}（请用 OPENX_MOCK_PI=1 启动 server）`);

      }



      const goalRes = await get(`/api/goals/${turn.data.data.runId}`);

      if (goalRes.goal?.conversationId === "openx-miloco-events") {

        ok("Webhook 已在 Miloco 感知事件会话创建 Goal");

      } else {

        fail(`Goal 会话异常: ${goalRes.goal?.conversationId}`);

      }



      const trace = await post(

        "/api/miloco/webhook",

        { action: "get_trace", payload: { runId: turn.data.data.runId } },

        { authorization: `Bearer ${token}` },

      );

      if (trace.status === 200 && trace.data.code === 0 && trace.data.data?.status === "done") {

        ok("Webhook get_trace 返回 done");

      } else {

        fail(`get_trace 异常: ${trace.text}`);

      }

    } else {

      fail(`Webhook agent turn 失败: ${turn.status} ${turn.text}`);

    }

  }



  if (failed === 0) {

    console.log("\n全部冒烟测试通过。");

  } else {

    console.error(`\n${failed} 项失败。`);

    process.exit(1);

  }

}



main().catch((err) => {

  console.error(err);

  process.exit(1);

});


