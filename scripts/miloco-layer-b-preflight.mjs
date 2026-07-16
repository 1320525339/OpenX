#!/usr/bin/env node
/**
 * Layer B preflight: software checks + optional watch for real perception Goal.
 *
 * Exit codes:
 *   0 — software ready (+ watch succeeded if cameras ready)
 *   1 — software check failed or watch timeout/error
 *   2 — software OK but no ready cameras (hardware not ready)
 *
 * Usage:
 *   node scripts/miloco-layer-b-preflight.mjs
 *   MILOCO_LAYER_B_PREFLIGHT_SKIP_WATCH=1 node scripts/miloco-layer-b-preflight.mjs
 */

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.OPENX_API_BASE ?? process.env.OPENX_BASE_URL ?? "http://127.0.0.1:3921";
const SKIP_WATCH = process.env.MILOCO_LAYER_B_PREFLIGHT_SKIP_WATCH === "1";

const SOFTWARE_CHECK_IDS = new Set([
  "miloco_service",
  "omni_api_key",
  "wsl_webhook",
  "miloco_webhook_config",
  "pi_executor",
]);

const DISTRO = process.env.OPENX_MILOCO_WSL_DISTRO ?? "Ubuntu";

function detectWslGateway() {
  const r = spawnSync(
    "wsl",
    ["-d", DISTRO, "bash", "-lc", "ip route show default 2>/dev/null | awk '{print $3; exit}'"],
    { encoding: "utf8" },
  );
  return (r.stdout ?? "").match(/\d+\.\d+\.\d+\.\d+/)?.[0] ?? null;
}

/** 独立 WSL 探针（与 Miloco dispatcher 同路径，避免 server 内嵌 spawn 偶发误报） */
function probeWslWebhookFromCli() {
  const base = new URL(BASE);
  const host = base.hostname === "127.0.0.1" ? detectWslGateway() : base.hostname;
  if (!host) return { ok: false, detail: "无法检测 WSL 网关 IP" };
  const port = base.port || "3921";
  const url = `http://${host}:${port}/api/miloco/webhook`;
  const r = spawnSync(
    "wsl",
    [
      "-d",
      DISTRO,
      "bash",
      "-lc",
      `curl -sS --connect-timeout 5 --max-time 10 -o /dev/null -w '%{http_code}' '${url}' 2>/dev/null || true`,
    ],
    { encoding: "utf8" },
  );
  const code = `${r.stdout ?? ""}${r.stderr ?? ""}`.match(/\d{3}/)?.[0] ?? "";
  if (code === "200") return { ok: true, detail: `WSL 可访问 ${url}（preflight 独立探针）` };
  return { ok: false, detail: `WSL 独立探针失败 ${url}（http=${code || "none"}）` };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function main() {
  console.log(`Layer B preflight — ${BASE}\n`);

  const layerB = await get("/api/miloco/layer-b");
  let softwareFailed = false;
  let wslWebhookOk = false;

  for (const c of layerB.checks ?? []) {
    let ok = c.ok;
    let detail = c.detail;
    if (c.id === "wsl_webhook" && !c.ok) {
      const probe = probeWslWebhookFromCli();
      if (probe.ok) {
        ok = true;
        detail = probe.detail;
        wslWebhookOk = true;
      }
    } else if (c.id === "wsl_webhook" && c.ok) {
      wslWebhookOk = true;
    }
    const mark = ok ? "✓" : "✗";
    const tag = SOFTWARE_CHECK_IDS.has(c.id) ? "[软件]" : "[信息]";
    console.log(`${mark} ${tag} ${c.id}: ${detail}`);
    if (SOFTWARE_CHECK_IDS.has(c.id) && !ok) softwareFailed = true;
  }

  if (!wslWebhookOk) {
    const probe = probeWslWebhookFromCli();
    const mark = probe.ok ? "✓" : "✗";
    console.log(`${mark} [软件] wsl_webhook_cli: ${probe.detail}`);
    if (!probe.ok) softwareFailed = true;
    else wslWebhookOk = true;
  }

  const readyCameras = (layerB.cameras ?? []).filter(
    (c) => c.in_use && c.is_online && c.connected,
  );

  console.log(`\nLayer B ready: ${layerB.ready}`);
  console.log(`就绪摄像头: ${readyCameras.length}`);

  if (softwareFailed) {
    console.error("\n软件检查未通过，请先修复 service / omni / webhook / Pi。");
    process.exit(1);
  }

  if (readyCameras.length === 0) {
    console.warn("\n软件检查通过，但无就绪摄像头（in_use+online+connected）。");
    console.warn("请检查硬件/网络，或在 Web UI 启用摄像头 scope。");
    if (SKIP_WATCH) process.exit(2);
    console.warn("仍将尝试监听感知 Goal（可能超时）…\n");
  }

  if (SKIP_WATCH) {
    console.log("\n跳过 watch（MILOCO_LAYER_B_PREFLIGHT_SKIP_WATCH=1）。");
    process.exit(readyCameras.length > 0 ? 0 : 2);
  }

  const watch = spawnSync(
    process.execPath,
    [join(ROOT, "scripts/miloco-layer-b-watch.mjs")],
    {
      stdio: "inherit",
      env: process.env,
      cwd: ROOT,
    },
  );
  process.exit(watch.status ?? 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
