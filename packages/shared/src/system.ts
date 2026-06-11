/** 系统项目与会话固定 ID（与 apps/server system-workspace 一致） */
export const SYSTEM_PROJECT_ID = "openx-system";
export const SYSTEM_CLI_CONVERSATION_ID = "openx-system-cli";
export const SYSTEM_MAIN_CONVERSATION_ID = "openx-system-main";

/** 发布到任务池、由任意在线 Connect CLI 认领的哨兵执行器 */
export const CONNECT_ANY_EXECUTOR_ID = "connect:any";

export function isSystemProjectId(id: string): boolean {
  return id === SYSTEM_PROJECT_ID;
}

export function isSystemConversationId(id: string): boolean {
  return id === SYSTEM_CLI_CONVERSATION_ID || id === SYSTEM_MAIN_CONVERSATION_ID;
}

export function isConnectAnyExecutorId(id: string): boolean {
  return id === CONNECT_ANY_EXECUTOR_ID;
}
