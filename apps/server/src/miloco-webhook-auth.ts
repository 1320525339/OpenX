import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { OPENX_MILOCO_WEBHOOK_TOKEN_ENV } from "@openx/shared";
import { getMilocoWebhookTokenPath } from "./paths.js";

let cachedToken: string | undefined;

/** 获取或生成 OPENX_HOME/miloco-webhook.token（Miloco 入站 webhook Bearer） */
export function getOrCreateMilocoWebhookToken(): string {
  const envToken = process.env[OPENX_MILOCO_WEBHOOK_TOKEN_ENV]?.trim();
  if (envToken) return envToken;
  if (cachedToken) return cachedToken;

  const tokenPath = getMilocoWebhookTokenPath();
  if (existsSync(tokenPath)) {
    cachedToken = readFileSync(tokenPath, "utf8").trim();
    if (cachedToken) return cachedToken;
  }

  cachedToken = randomBytes(32).toString("hex");
  mkdirSync(dirname(tokenPath), { recursive: true });
  writeFileSync(tokenPath, cachedToken, { mode: 0o600 });
  return cachedToken;
}

export function isMilocoWebhookTokenConfigured(): boolean {
  if (process.env[OPENX_MILOCO_WEBHOOK_TOKEN_ENV]?.trim()) return true;
  if (cachedToken) return true;
  const tokenPath = getMilocoWebhookTokenPath();
  if (existsSync(tokenPath)) {
    const token = readFileSync(tokenPath, "utf8").trim();
    return token.length > 0;
  }
  return false;
}

/** 校验 Authorization: Bearer <token> */
export function verifyMilocoWebhookBearer(authHeader: string | undefined): boolean {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const provided = authHeader.slice("Bearer ".length).trim();
  if (!provided) return false;
  return provided === getOrCreateMilocoWebhookToken();
}
