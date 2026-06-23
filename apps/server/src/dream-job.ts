import {
  getConversationById,
  listGoals,
  listReviewRoundEntries,
  getProjectById,
} from "./db.js";
import { loadSettings } from "./settings-store.js";
import { resolveWorkspaceRoot } from "./workspace-path.js";
import { resolveSystemWorkspaceRoot } from "./system-workspace-path.js";
import {
  appendRuntimeMemorySection,
  ensureRuntimeMemoryInitialized,
  readRuntimeMemory,
} from "./knowledge-store.js";

export type DreamDistillResult = {
  ok: boolean;
  projectId: string;
  sectionsWritten: number;
  memoryChars: number;
  detail: string;
};

function collectRecentLessons(projectId: string): string[] {
  const lessons: string[] = [];
  const goals = listGoals({ projectId }).slice(0, 40);

  for (const goal of goals) {
    if (goal.status === "failed") {
      lessons.push(
        `- [失败] 「${goal.title}」：${goal.reworkReason?.trim() || "执行失败，见日志"}`,
      );
    }
    if (goal.effectStatus === "rework" && goal.reworkReason?.trim()) {
      lessons.push(
        `- [返工] 「${goal.title}」：${goal.reworkReason.trim().slice(0, 280)}`,
      );
    }
    const rounds = listReviewRoundEntries(goal.id, 3);
    for (const round of rounds) {
      if (round.verdict === "fail") {
        lessons.push(
          `- [审查${round.roundLabel}] 「${goal.title}」：${round.reason.slice(0, 240)}`,
        );
      }
    }
  }

  return lessons.slice(0, 24);
}

/** 轻量 Dream/Distill：将近期失败/审查经验写入项目 MEMORY */
export function distillProjectMemory(projectId: string): DreamDistillResult {
  const project = getProjectById(projectId);
  if (!project) {
    return {
      ok: false,
      projectId,
      sectionsWritten: 0,
      memoryChars: 0,
      detail: "项目不存在",
    };
  }

  const settings = loadSettings();
  const workspaceRoot = resolveWorkspaceRoot(
    project.workspaceDir ?? resolveSystemWorkspaceRoot(settings),
  );

  const lessons = collectRecentLessons(projectId);
  if (lessons.length === 0) {
    ensureRuntimeMemoryInitialized(workspaceRoot, projectId);
    const existing = readRuntimeMemory(workspaceRoot, projectId);
    return {
      ok: true,
      projectId,
      sectionsWritten: 0,
      memoryChars: existing?.length ?? 0,
      detail: "暂无新的失败/审查经验可蒸馏",
    };
  }

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const body = [
    `更新时间：${stamp}`,
    `条目数：${lessons.length}`,
    "",
    "### 失败 / 返工 / 审查",
    ...lessons,
  ].join("\n");
  appendRuntimeMemorySection(workspaceRoot, projectId, "蒸馏经验", body);

  const memory = readRuntimeMemory(workspaceRoot, projectId) ?? "";

  return {
    ok: true,
    projectId,
    sectionsWritten: 1,
    memoryChars: memory.length,
    detail: `已蒸馏 ${lessons.length} 条经验`,
  };
}

/** 按对话所属项目蒸馏 */
export function distillMemoryForConversation(
  conversationId: string,
): DreamDistillResult | null {
  const conversation = getConversationById(conversationId);
  if (!conversation) return null;
  return distillProjectMemory(conversation.projectId);
}
