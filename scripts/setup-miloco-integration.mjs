#!/usr/bin/env node

/**

 * Miloco × OpenX 一键接入：

 * - 同步 Miloco Skills 到 ~/.openx/skills

 * - 绑定 pi 执行器

 * - 生成 webhook token

 * - 可选添加 Miloco Dashboard 拓展槽

 * - 可选配置 WSL Miloco webhook 指向 OpenX

 *

 * Usage:

 *   node scripts/setup-miloco-integration.mjs

 *   node scripts/setup-miloco-integration.mjs --force

 *   node scripts/setup-miloco-integration.mjs --add-card

 *   node scripts/setup-miloco-integration.mjs --connect-wsl

 */



import { readFileSync } from "node:fs";

import { join } from "node:path";

import { homedir } from "node:os";

import { spawnSync } from "node:child_process";

import { fileURLToPath } from "node:url";

import { dirname, resolve } from "node:path";



const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const BASE = process.env.OPENX_API_BASE ?? "http://127.0.0.1:3921";



async function post(path, body) {

  const res = await fetch(`${BASE}${path}`, {

    method: "POST",

    headers: { "content-type": "application/json" },

    body: JSON.stringify(body ?? {}),

  });

  const text = await res.text();

  let data;

  try {

    data = JSON.parse(text);

  } catch {

    data = { raw: text };

  }

  if (!res.ok) {

    throw new Error(`${path} → ${res.status}: ${text}`);

  }

  return data;

}



async function get(path) {

  const res = await fetch(`${BASE}${path}`);

  const text = await res.text();

  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text}`);

  return JSON.parse(text);

}



async function addMilocoCard() {

  const scope = "console";

  const { catalog } = await get(`/api/desktop/slots?scope=${scope}`);

  const existing = catalog.slots?.find(

    (s) => s.config?.kind === "browser" && s.config?.startUrl?.includes(":1810"),

  );

  if (existing) {

    console.log(`[miloco] 拓展槽已存在: ${existing.id}`);

    return;

  }

  const body = {

    templateId: "miloco-dashboard",

    title: "Miloco 面板",

    pinCol: 1,

  };

  const res = await post(`/api/desktop/slots?scope=${scope}`, body);

  console.log("[miloco] 已添加 Miloco Dashboard 拓展槽", res.slotId ?? "");

}



function connectMilocoWebhookWsl() {

  const script = join(ROOT, "scripts", "miloco-connect-wsl.ps1");

  const result = spawnSync(

    "powershell",

    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],

    { stdio: "inherit", cwd: ROOT },

  );

  if (result.status !== 0) {

    throw new Error(`miloco-connect-wsl.ps1 failed with code ${result.status}`);

  }

}



function readWebhookToken() {

  const tokenPath = join(homedir(), ".openx", "miloco-webhook.token");

  try {

    return readFileSync(tokenPath, "utf8").trim();

  } catch {

    return null;

  }

}



async function main() {

  const force = process.argv.includes("--force");

  const addCard = process.argv.includes("--add-card");

  const connectWsl = process.argv.includes("--connect-wsl");

  // 确保启用 Miloco 插件（默认已改为关闭）
  try {
    const envPath = join(homedir(), ".openx", ".env");
    let existing = "";
    try {
      existing = readFileSync(envPath, "utf8");
    } catch {
      existing = "";
    }
    if (!/^OPENX_MILOCO=/m.test(existing)) {
      const { mkdirSync, writeFileSync, appendFileSync } = await import("node:fs");
      mkdirSync(join(homedir(), ".openx"), { recursive: true });
      if (!existing) {
        writeFileSync(envPath, "OPENX_MILOCO=1\n", "utf8");
      } else {
        appendFileSync(envPath, "\nOPENX_MILOCO=1\n", "utf8");
      }
      console.log("[miloco] 已写入 ~/.openx/.env → OPENX_MILOCO=1（需重启 OpenX server）");
    }
  } catch (err) {
    console.warn("[miloco] 无法写入 OPENX_MILOCO=1:", err instanceof Error ? err.message : err);
  }

  console.log(`[miloco] OpenX API: ${BASE}`);

  const setup = await post("/api/miloco/setup", { force });

  console.log("[miloco] setup:", JSON.stringify(setup, null, 2));



  const status = await get("/api/miloco/status");

  console.log("[miloco] status:", JSON.stringify(status, null, 2));



  const token = readWebhookToken();

  if (token) {

    console.log(`[miloco] webhook token: ${token.slice(0, 8)}... (${join(homedir(), ".openx", "miloco-webhook.token")})`);

  } else {

    console.warn("[miloco] webhook token 未生成，请确认 OpenX server 已启动并完成 setup");

  }



  if (addCard) {

    await addMilocoCard();

  }



  if (connectWsl) {

    connectMilocoWebhookWsl();

  } else if (status.webhook?.url) {

    console.log(`[miloco] 配置 WSL Miloco webhook: node scripts/setup-miloco-integration.mjs --connect-wsl`);

    console.log(`[miloco] 或手动: .\\scripts\\miloco-connect-wsl.ps1`);

  }



  if (!setup.ok) {

    process.exit(1);

  }

}



main().catch((err) => {

  console.error(err);

  process.exit(1);

});


