/**
 * 审查上下文：工作区文件证据 + 多轮审查记录累积（每轮携带更多信息）。
 */
import {
  parseDeliverablesFromSummary,
  resolveGoalDeliverables,
  type Goal,
  type GoalDeliverable,
} from "@openx/shared";
import type { ReviewVerdict } from "@openx/coach";
import { clipPromptText } from "@openx/shared";
import type { VerifyCommandResult } from "./review-verify.js";
import { appendLog, listRunEventRecords, REVIEW_ROUND_LOG_PREFIX } from "./db.js";
import { readWorkspaceFilePreview } from "./workspace-file-preview.js";

const MAX_EVIDENCE_FILES = 8;
const MAX_FILE_CHARS = 4_000;

export type ReviewPacket = {
  fileEvidence: string;
  deliverablesSummary: string;
  priorReviewRounds: string[];
  runTrajectory: string;
};

function clipInline(text: string | undefined, max: number): string {
  const t = text?.trim() ?? "";
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** 从 run_events 提取工具轨迹，供审查员冷读（对齐 MiMo judge 读 transcript） */
export function summarizeRunTrajectory(
  goalId: string,
  maxTokens = 2_500,
): string {
  const events = listRunEventRecords(goalId, 200);
  const lines: string[] = [];

  for (const event of events) {
    if (event.type === "tool.start") {
      const preview = clipInline(event.argsPreview, 120);
      lines.push(
        preview
          ? `- ${event.tool}: ${preview}`
          : `- ${event.tool}`,
      );
      continue;
    }
    if (event.type === "tool.end") {
      const preview = clipInline(event.resultPreview, 160);
      if (event.isError) {
        lines.push(preview ? `  → ERROR: ${preview}` : "  → ERROR");
      } else if (preview) {
        lines.push(`  → ${preview}`);
      }
      continue;
    }
    if (event.type === "status") {
      lines.push(`- status: ${clipInline(event.message, 200)}`);
    }
  }

  if (lines.length === 0) {
    return "（无工具轨迹记录；请依据结果摘要、文件证据与验证命令输出判断）";
  }

  return clipPromptText(lines.join("\n"), maxTokens);
}

function uniqueFilePaths(goal: Goal): string[] {
  const paths = new Set<string>();
  for (const item of resolveGoalDeliverables(goal)) {
    if (item.kind === "file") paths.add(item.path);
  }
  for (const item of parseDeliverablesFromSummary(goal.resultSummary)) {
    if (item.kind === "file") paths.add(item.path);
  }
  return [...paths].slice(0, MAX_EVIDENCE_FILES);
}

function deliverablePreview(
  path: string,
  deliverables: GoalDeliverable[],
): string | undefined {
  const item = deliverables.find((d) => d.kind === "file" && d.path === path);
  if (item?.kind !== "file") return undefined;
  if (item.preview?.trim()) return item.preview.trim();
  if (item.previousContent?.trim()) {
    return `（修改前摘录）\n${item.previousContent.trim()}`;
  }
  return undefined;
}

/** 从 deliverables + 工作区读取文件内容，供审查员 verify */
export function collectReviewFileEvidence(
  goal: Goal,
  workspaceRoot: string,
): string {
  const deliverables = resolveGoalDeliverables(goal);
  const paths = uniqueFilePaths(goal);
  if (paths.length === 0) {
    return "（未解析到可验证文件路径；请结合摘要与日志判断，倾向 fail）";
  }

  const blocks: string[] = [];
  for (const path of paths) {
    const embedded = deliverablePreview(path, deliverables);
    if (embedded) {
      const clipped =
        embedded.length > MAX_FILE_CHARS
          ? `${embedded.slice(0, MAX_FILE_CHARS)}…`
          : embedded;
      blocks.push(`### ${path}\n\`\`\`\n${clipped}\n\`\`\``);
      continue;
    }

    const read = readWorkspaceFilePreview(path, workspaceRoot);
    if (read.ok) {
      const clipped =
        read.content.length > MAX_FILE_CHARS
          ? `${read.content.slice(0, MAX_FILE_CHARS)}…`
          : read.content;
      blocks.push(
        `### ${path}${read.truncated ? " (文件过大已截断)" : ""}\n\`\`\`${read.language ?? ""}\n${clipped}\n\`\`\``,
      );
    } else {
      blocks.push(`### ${path}\n（工作区中不存在或无法读取为文件）`);
    }
  }
  return blocks.join("\n\n");
}

export function summarizeDeliverables(goal: Goal): string {
  const items = resolveGoalDeliverables(goal);
  if (items.length === 0) return "（无结构化交付物）";
  return items
    .map((item) => {
      if (item.kind === "file") {
        return `- 文件 ${item.path}${item.action ? ` [${item.action}]` : ""}`;
      }
      if (item.kind === "link") return `- 链接 ${item.url}`;
      return `- 代码片段 ${item.label ?? ""}`;
    })
    .join("\n");
}

export function recordReviewRound(
  goalId: string,
  round: number,
  verdict: ReviewVerdict,
  verifyResults?: VerifyCommandResult[],
): void {
  const payload = JSON.stringify({
    round,
    verdict: verdict.verdict,
    reason: verdict.reason,
    reworkInstruction: verdict.reworkInstruction,
    reworkTargets: verdict.reworkTargets,
    blocked: verdict.blocked,
    verifyResults: verifyResults?.map((r) => ({
      command: r.command,
      ok: r.ok,
      exitCode: r.exitCode,
      timedOut: r.timedOut,
      stdout: r.stdout.slice(0, 3_000),
      stderr: r.stderr.slice(0, 1_500),
    })),
  });
  appendLog(goalId, "info", `${REVIEW_ROUND_LOG_PREFIX}${payload}`);
}

export function buildReviewPacket(
  goal: Goal,
  workspaceRoot: string,
  priorReviewRounds: string[],
): ReviewPacket {
  return {
    fileEvidence: collectReviewFileEvidence(goal, workspaceRoot),
    deliverablesSummary: summarizeDeliverables(goal),
    priorReviewRounds,
    runTrajectory: summarizeRunTrajectory(goal.id),
  };
}
