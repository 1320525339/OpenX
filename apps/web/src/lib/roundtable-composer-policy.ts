/** 圆桌 Composer 策略：可单测的纯函数，避免 ChatPanel 巨型组件快照 */

/** 会话 mode 或已有席位时走圆桌发送路径 */
export function resolveEffectiveRoundtable(
  conversationMode: "foreman" | "roundtable" | undefined,
  participantCount: number,
): boolean {
  return conversationMode === "roundtable" || participantCount > 0;
}

/**
 * Context（Skill/MCP/知识/权限）已接入 createChatRound，圆桌不再灰显。
 * 保留函数供调用方统一判断；恒为 false。
 */
export function shouldDisableChatContext(_isRoundtable: boolean): boolean {
  return false;
}

export function chatContextDisabledReason(
  _isRoundtable: boolean,
): string | undefined {
  return undefined;
}

/** 席位显示计数：空席时工头占位计为 1 */
export function displaySeatCount(participantCount: number): number {
  return participantCount > 0 ? participantCount : 1;
}
