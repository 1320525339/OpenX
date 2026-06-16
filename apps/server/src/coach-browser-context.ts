import type { CoachChatContext } from "@openx/shared";
import {
  buildBrowserDesktopContext,
  pinDesktopScopeForConversation,
} from "./browser-desktop-context.js";

export async function attachBrowserDesktopContext(
  ctx: CoachChatContext,
  conversationId: string,
): Promise<void> {
  const scope = pinDesktopScopeForConversation(conversationId);
  const block = await buildBrowserDesktopContext(scope);
  if (block) ctx.browserDesktopContext = block;
}
