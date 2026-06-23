export type OpenxEventName = "goal_failed";

export type OpenxEventPayload = {
  goalId: string;
  errorMessage: string;
};

type EventWebhookHandler = (
  event: OpenxEventName,
  payload: OpenxEventPayload,
) => Promise<void> | void;

let handler: EventWebhookHandler | undefined;

export function registerEventWebhookHandler(next?: EventWebhookHandler): void {
  handler = next;
}

export function resetEventWebhookHandler(): void {
  handler = undefined;
}

export async function notifyEventWebhook(
  event: OpenxEventName,
  payload: OpenxEventPayload,
): Promise<void> {
  try {
    await handler?.(event, payload);
  } catch (err) {
    console.warn(
      "[event-webhook] 事件处理失败:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
