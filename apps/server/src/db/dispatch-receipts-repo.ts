import { nanoid } from "nanoid";
import type { DispatchContext } from "@openx/shared";
import { getDb } from "./connection.js";

export type DispatchReceipt = {
  receiptId: string;
  goalId: string;
  runId: string;
  executorId: string;
  dispatchContext?: DispatchContext;
  workspaceRoot?: string;
  ackAt?: string;
  createdAt: string;
};

type ReceiptRow = {
  receipt_id: string;
  goal_id: string;
  run_id: string;
  executor_id: string;
  dispatch_context_json: string | null;
  workspace_root: string | null;
  ack_at: string | null;
  created_at: string;
};

function rowToReceipt(row: ReceiptRow): DispatchReceipt {
  let dispatchContext: DispatchContext | undefined;
  if (row.dispatch_context_json?.trim()) {
    try {
      dispatchContext = JSON.parse(row.dispatch_context_json) as DispatchContext;
    } catch {
      dispatchContext = undefined;
    }
  }
  return {
    receiptId: row.receipt_id,
    goalId: row.goal_id,
    runId: row.run_id,
    executorId: row.executor_id,
    dispatchContext,
    workspaceRoot: row.workspace_root ?? undefined,
    ackAt: row.ack_at ?? undefined,
    createdAt: row.created_at,
  };
}

export function insertDispatchReceipt(input: {
  goalId: string;
  runId: string;
  executorId: string;
  dispatchContext?: DispatchContext | null;
  workspaceRoot?: string;
}): DispatchReceipt {
  const receiptId = nanoid();
  const createdAt = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO dispatch_receipts
        (receipt_id, goal_id, run_id, executor_id, dispatch_context_json, workspace_root, created_at)
       VALUES (@receiptId, @goalId, @runId, @executorId, @dispatchContextJson, @workspaceRoot, @createdAt)`,
    )
    .run({
      receiptId,
      goalId: input.goalId,
      runId: input.runId,
      executorId: input.executorId,
      dispatchContextJson: input.dispatchContext
        ? JSON.stringify(input.dispatchContext)
        : null,
      workspaceRoot: input.workspaceRoot ?? null,
      createdAt,
    });
  return {
    receiptId,
    goalId: input.goalId,
    runId: input.runId,
    executorId: input.executorId,
    dispatchContext: input.dispatchContext ?? undefined,
    workspaceRoot: input.workspaceRoot,
    createdAt,
  };
}

export function getLatestDispatchReceipt(goalId: string): DispatchReceipt | undefined {
  const row = getDb()
    .prepare(
      `SELECT * FROM dispatch_receipts WHERE goal_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(goalId) as ReceiptRow | undefined;
  return row ? rowToReceipt(row) : undefined;
}

export function getDispatchReceipt(receiptId: string): DispatchReceipt | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM dispatch_receipts WHERE receipt_id = ?`)
    .get(receiptId) as ReceiptRow | undefined;
  return row ? rowToReceipt(row) : undefined;
}

/** Connect 执行器确认已收到派单（幂等） */
export function ackDispatchReceipt(receiptId: string): DispatchReceipt | undefined {
  const existing = getDispatchReceipt(receiptId);
  if (!existing) return undefined;
  if (existing.ackAt) return existing;
  const ackAt = new Date().toISOString();
  getDb()
    .prepare(`UPDATE dispatch_receipts SET ack_at = ? WHERE receipt_id = ?`)
    .run(ackAt, receiptId);
  return { ...existing, ackAt };
}
