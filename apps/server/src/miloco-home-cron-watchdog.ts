import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import type { Conversation } from "@openx/shared";
import {
  DEFAULT_MILOCO_HOME_CRON_TICK_MS,
  MILOCO_CRON_CONVERSATION_ID,
  OPENX_MILOCO_HOME_CRON_TICK_ENV,
  OPENX_MILOCO_HOME_CRON_WATCH_ENV,
  resolveMilocoLanePolicy,
} from "@openx/shared";
import {
  getConversationById,
  insertConversation,
  insertGoal,
} from "./db.js";
import { claimGoalForDispatch } from "./goal-lifecycle.js";
import { dispatchGoal } from "./orchestrator.js";
import { broadcast } from "./sse.js";
import { ensureSystemProject } from "./system-workspace.js";
import { loadMilocoUserConfig } from "./miloco-config.js";
import { getMilocoCronStatePath, getMilocoMemoryDir, getOpenxHome } from "./paths.js";

function cronStatePath(): string {
  return getMilocoCronStatePath();
}

function resolveCronTimezone(): string {
  return loadMilocoUserConfig().timezone?.trim() || "Asia/Shanghai";
}

export type MilocoCronTaskName =
  | "miloco-perception-digest"
  | "miloco-home-patrol"
  | "miloco-home-dreaming"
  | "miloco-habit-suggest";

export type MilocoCronTaskDef = {
  name: MilocoCronTaskName;
  description: string;
  cronExpr: string;
  skillIds: string[];
  message: string;
  title: string;
};

export const MILOCO_CRON_TASKS: MilocoCronTaskDef[] = [
  {
    name: "miloco-perception-digest",
    description: "感知引擎日志摘要/压缩",
    cronExpr: "*/15 * * * *",
    skillIds: ["miloco-perception-digest"],
    message: "执行感知日志摘要。加载 miloco-perception-digest skill 进行处理。",
    title: "[Miloco Cron] 感知日志摘要",
  },
  {
    name: "miloco-home-patrol",
    description: "家庭记忆/习惯巡检",
    cronExpr: "*/30 * * * *",
    skillIds: [
      "miloco-home-patrol",
      "miloco-devices",
      "miloco-notify",
      "miloco-home-profile",
    ],
    message: "执行家庭巡检。加载 miloco-home-patrol skill 进行巡检。",
    title: "[Miloco Cron] 家庭巡检",
  },
  {
    name: "miloco-home-dreaming",
    description: "家庭记忆 Dreaming（Observe → Promote → Prune）",
    cronExpr: "0 0 * * *",
    skillIds: [
      "miloco-home-observe",
      "miloco-home-promote",
      "miloco-home-prune",
      "miloco-home-profile",
    ],
    message: `执行 home-dreaming 流程。依次完成以下步骤：
1. **Observe** — 加载 miloco-home-observe skill，从感知/交互记忆中提取新知识写入候选区
2. **Promote** — 加载 miloco-home-promote skill，将候选区中达到条件的知识提升到正式档案
3. **Prune** — 加载 miloco-home-prune skill，统一主体命名、清理过期数据、提交持久化

执行规则：按顺序依次执行不可跳过。Step 1 没有新知识时仍需执行 Step 2。`,
    title: "[Miloco Cron] home-dreaming",
  },
  {
    name: "miloco-habit-suggest",
    description: "每日习惯洞察 → 推荐建任务",
    cronExpr: "0 10 * * *",
    skillIds: [
      "miloco-habit-suggest",
      "miloco-notify",
      "miloco-create-task",
      "miloco-home-profile",
    ],
    message:
      "执行每日习惯洞察。加载 miloco-habit-suggest skill，按「路径 A · 扫描推荐」处理：从家庭档案识别值得建成任务的习惯，至多主动推荐一条。",
    title: "[Miloco Cron] 习惯洞察",
  },
];

export type MilocoCronRunRecord = {
  taskName: MilocoCronTaskName;
  goalId: string;
  triggeredAt: string;
};

export type MilocoHomeCronStatus = {
  enabled: boolean;
  tickMs: number;
  memoryDir: string;
  conversationId: string;
  tasks: Array<{
    name: MilocoCronTaskName;
    description: string;
    cronExpr: string;
    nextHint: string;
  }>;
  recentRuns: MilocoCronRunRecord[];
};

let timer: ReturnType<typeof setInterval> | undefined;
const lastFiredSlot = new Map<MilocoCronTaskName, string>();
const recentRuns: MilocoCronRunRecord[] = [];
let inflight = false;

function loadCronPersistedState(): void {
  if (!existsSync(cronStatePath())) return;
  try {
    const parsed = JSON.parse(readFileSync(cronStatePath(), "utf8")) as {
      lastFiredSlot?: Record<string, string>;
      recentRuns?: MilocoCronRunRecord[];
    };
    lastFiredSlot.clear();
    for (const [k, v] of Object.entries(parsed.lastFiredSlot ?? {})) {
      lastFiredSlot.set(k as MilocoCronTaskName, v);
    }
    recentRuns.length = 0;
    if (Array.isArray(parsed.recentRuns)) {
      recentRuns.push(...parsed.recentRuns.slice(0, 20));
    }
  } catch {
    /* ignore */
  }
}

function persistCronState(): void {
  mkdirSync(getOpenxHome(), { recursive: true });
  const payload = {
    lastFiredSlot: Object.fromEntries(lastFiredSlot),
    recentRuns: recentRuns.slice(0, 20),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(cronStatePath(), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function isMilocoHomeCronWatchEnabled(): boolean {
  return process.env[OPENX_MILOCO_HOME_CRON_WATCH_ENV] === "1";
}

export function resolveMilocoHomeCronTickMs(): number {
  const raw = process.env[OPENX_MILOCO_HOME_CRON_TICK_ENV]?.trim();
  if (!raw) return DEFAULT_MILOCO_HOME_CRON_TICK_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 15_000) return DEFAULT_MILOCO_HOME_CRON_TICK_MS;
  return parsed;
}

export function ensureMilocoMemoryLayout(): string {
  const root = getMilocoMemoryDir();
  mkdirSync(join(root, "memory"), { recursive: true });
  return root;
}

function shanghaiParts(date = new Date()): { minute: number; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveCronTimezone(),
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  return { minute, hour };
}

function slotKey(date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: resolveCronTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(" ", "T");
}

/** 轻量 cron 匹配（仅支持本模块 4 条固定 expr） */
export function cronExprMatches(expr: string, date = new Date()): boolean {
  const { minute, hour } = shanghaiParts(date);
  const [minField, hourField] = expr.split(/\s+/);
  if (minField?.startsWith("*/")) {
    const step = Number(minField.slice(2));
    if (!Number.isFinite(step) || step <= 0) return false;
    if (hourField === "*" && minute % step === 0) return true;
  }
  if (minField === "0" && hourField === "0" && hour === 0 && minute === 0) return true;
  if (minField === "0" && hourField === "10" && hour === 10 && minute === 0) return true;
  return false;
}

export function ensureMilocoCronConversation(): Conversation {
  ensureSystemProject();
  let conversation = getConversationById(MILOCO_CRON_CONVERSATION_ID);
  if (!conversation) {
    const now = new Date().toISOString();
    conversation = insertConversation({
      id: MILOCO_CRON_CONVERSATION_ID,
      projectId: "openx-system",
      title: "Miloco 家庭 Cron",
      createdAt: now,
      updatedAt: now,
    });
  }
  return conversation;
}

function buildCronExecutionPrompt(task: MilocoCronTaskDef): string {
  const memoryDir = ensureMilocoMemoryLayout();
  return [
    "【Miloco 家庭 Cron · OpenX】",
    `任务: ${task.name}`,
    `记忆目录: ${memoryDir}`,
    `- 感知摘要: ${memoryDir}/memory/YYYY-MM-DD-miloco-perception.md`,
    `- 交互记忆: ${memoryDir}/memory/YYYY-MM-DD.md`,
    "",
    task.message,
  ].join("\n");
}

export function dispatchMilocoCronGoal(task: MilocoCronTaskDef): string {
  const conversation = ensureMilocoCronConversation();
  const now = new Date().toISOString();
  const goalId = nanoid();
  const policy = resolveMilocoLanePolicy("miloco-rule");
  const goal = {
    id: goalId,
    orderNo: 0,
    conversationId: conversation.id,
    title: task.title,
    acceptance: `完成 ${task.name} 定时任务并按 Skill 规范静默或 notify。`,
    userDraft: task.message,
    executionPrompt: buildCronExecutionPrompt(task),
    constraints: [] as string[],
    executorId: "pi" as const,
    dependsOn: [] as string[],
    priority: "medium" as const,
    autoReview: false,
    iterationCount: 0,
    dispatchContext: {
      skillIds: [...task.skillIds],
      permissionMode: policy.permissionMode,
    },
    foremanThreadId: conversation.id,
    status: "draft" as const,
    progress: 0,
    createdAt: now,
    updatedAt: now,
  };
  insertGoal(goal);
  broadcast({ type: "goal.updated", goal });
  const claimed = claimGoalForDispatch(goalId, ["draft"]);
  if (claimed) {
    broadcast({ type: "goal.updated", goal: claimed });
    void dispatchGoal(goalId);
  }
  recentRuns.unshift({ taskName: task.name, goalId, triggeredAt: now });
  if (recentRuns.length > 20) recentRuns.length = 20;
  persistCronState();
  return goalId;
}

export function triggerMilocoCronTask(name: MilocoCronTaskName): {
  ok: boolean;
  goalId?: string;
  error?: string;
} {
  const task = MILOCO_CRON_TASKS.find((t) => t.name === name);
  if (!task) return { ok: false, error: `unknown task: ${name}` };
  const goalId = dispatchMilocoCronGoal(task);
  lastFiredSlot.set(name, slotKey());
  persistCronState();
  return { ok: true, goalId };
}

function tickMilocoCron(): void {
  if (inflight) return;
  inflight = true;
  try {
    const slot = slotKey();
    const userCron = loadMilocoUserConfig().cronTasks;
    const tasks = MILOCO_CRON_TASKS.filter((t) => {
      const override = userCron?.find((c) => c.name === t.name);
      if (override && override.enabled === false) return false;
      return true;
    });
    for (const task of tasks) {
      const override = userCron?.find((c) => c.name === task.name);
      const expr = override?.cronExpr?.trim() || task.cronExpr;
      if (!cronExprMatches(expr)) continue;
      if (lastFiredSlot.get(task.name) === slot) continue;
      lastFiredSlot.set(task.name, slot);
      dispatchMilocoCronGoal({ ...task, cronExpr: expr });
    }
    persistCronState();
  } finally {
    inflight = false;
  }
}

export function getMilocoHomeCronStatus(): MilocoHomeCronStatus {
  const now = new Date();
  return {
    enabled: isMilocoHomeCronWatchEnabled(),
    tickMs: resolveMilocoHomeCronTickMs(),
    memoryDir: getMilocoMemoryDir(),
    conversationId: MILOCO_CRON_CONVERSATION_ID,
    tasks: MILOCO_CRON_TASKS.map((t) => ({
      name: t.name,
      description: t.description,
      cronExpr: t.cronExpr,
      nextHint: cronExprMatches(t.cronExpr, now)
        ? "当前分钟可触发"
        : "等待 cron 匹配"
    })),
    recentRuns: [...recentRuns],
  };
}

export function startMilocoHomeCronWatchdog(): void {
  if (!isMilocoHomeCronWatchEnabled()) return;
  if (timer) return;
  loadCronPersistedState();
  ensureMilocoMemoryLayout();
  const tickMs = resolveMilocoHomeCronTickMs();
  timer = setInterval(tickMilocoCron, tickMs);
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }
  tickMilocoCron();
}

export function stopMilocoHomeCronWatchdog(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

/** 测试用 */
export function runMilocoHomeCronTickOnce(): void {
  tickMilocoCron();
}

export function resetMilocoCronStateForTests(): void {
  lastFiredSlot.clear();
  recentRuns.length = 0;
}
