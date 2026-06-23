import { listProjects } from "./db.js";
import { distillProjectMemory } from "./dream-job.js";
import { isSystemProjectId } from "./system-workspace.js";

/** 默认每 30 分钟蒸馏一次各项目运行知识 */
const DEFAULT_DISTILL_INTERVAL_MS = 30 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | undefined;
let lastRunAt: string | undefined;

export type KnowledgeDistillRunSummary = {
  projectCount: number;
  distilled: number;
  skipped: number;
  errors: number;
  ranAt: string;
};

export function resolveKnowledgeDistillIntervalMs(): number {
  const raw = process.env.OPENX_KNOWLEDGE_DISTILL_INTERVAL_MS?.trim();
  if (!raw) return DEFAULT_DISTILL_INTERVAL_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 60_000) {
    return DEFAULT_DISTILL_INTERVAL_MS;
  }
  return parsed;
}

export function getKnowledgeDistillLastRunAt(): string | undefined {
  return lastRunAt;
}

/** 对所有用户项目执行运行知识蒸馏（无新经验则跳过写入） */
export function runKnowledgeDistillOnce(): KnowledgeDistillRunSummary {
  const ranAt = new Date().toISOString();
  lastRunAt = ranAt;
  let distilled = 0;
  let skipped = 0;
  let errors = 0;
  const projects = listProjects().filter((p) => !isSystemProjectId(p.id));

  for (const project of projects) {
    try {
      const result = distillProjectMemory(project.id);
      if (result.ok && result.sectionsWritten > 0) {
        distilled += 1;
      } else {
        skipped += 1;
      }
    } catch {
      errors += 1;
    }
  }

  return {
    projectCount: projects.length,
    distilled,
    skipped,
    errors,
    ranAt,
  };
}

export function startKnowledgeDistillWatchdog(): void {
  if (timer) return;
  const intervalMs = resolveKnowledgeDistillIntervalMs();
  timer = setInterval(runKnowledgeDistillOnce, intervalMs);
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }
}

export function stopKnowledgeDistillWatchdog(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
