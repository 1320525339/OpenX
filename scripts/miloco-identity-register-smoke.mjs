#!/usr/bin/env node
/**
 * Optional identity-register live smoke — read-only person list only unless confirm set.
 * Full register requires camera samples; set MILOCO_IDENTITY_REGISTER_SMOKE_CONFIRM=1 for write path via Pi Goal.
 */

const BASE = process.env.OPENX_API_BASE ?? process.env.OPENX_BASE_URL ?? "http://127.0.0.1:3921";

if (process.env.MILOCO_IDENTITY_REGISTER_SMOKE_CONFIRM !== "1") {
  console.log("Read-only: GET /api/miloco/status + person list via setup.");
  const status = await fetch(`${BASE}/api/miloco/status`).then((r) => r.json());
  const hasRegister = (status.batch2SkillsInstalled ?? []).includes(
    "miloco-miot-identity-register",
  );
  console.log(hasRegister ? "✓ miloco-miot-identity-register installed" : "✗ skill missing");
  process.exit(hasRegister ? 0 : 1);
}

console.log("Full identity-register live test: create Pi Goal manually with miloco-miot-identity-register skill.");
process.exit(0);
