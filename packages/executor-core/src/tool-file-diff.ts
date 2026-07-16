import { buildToolFileDiff, type ToolFileDiff } from "@openx/shared";
import type { GoalDeliverable } from "@openx/shared";

/** 从文件类交付物生成 tool.end 可附带的 diff 摘要 */
export function toolFileDiffFromDeliverable(
  deliverable: GoalDeliverable | null | undefined,
): ToolFileDiff | undefined {
  if (!deliverable || deliverable.kind !== "file") return undefined;
  if (deliverable.previousContent === undefined || !deliverable.preview) return undefined;
  return (
    buildToolFileDiff(deliverable.previousContent, deliverable.preview, {
      path: deliverable.path,
      maxLines: 80,
      maxBytes: 1_048_576,
    }) ?? undefined
  );
}
