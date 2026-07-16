/** OpenX REST API 机器可读目录 — Agent / MCP / Operator 自举用 */

import { tierSatisfies, type OperatorTier } from "./operator-tier.js";

export type ApiHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiEndpointDef = {
  id: string;
  method: ApiHttpMethod;
  path: string;
  category: string;
  summary: string;
  /** none = 公开 API；internal = 需 x-openx-internal-token */
  auth: "none" | "internal";
  pathParams?: string[];
  query?: Record<string, string>;
  bodyHint?: string;
  /** SSE 等非常规 HTTP 交互 */
  transport?: "http" | "sse";
  /** 工头 operator 调用所需最低权限 */
  minTier?: OperatorTier;
  /** admin 写操作是否须 UI 确认 */
  confirmRequired?: boolean;
};

export const OPENX_API_VERSION = "0.1.0";

export const OPENX_API_CATEGORIES = [
  "health",
  "events",
  "settings",
  "workspace",
  "mcp",
  "executors",
  "skills",
  "projects",
  "conversations",
  "goals",
  "coach",
  "model",
  "cli",
  "connect",
  "internal",
  "catalog",
  "system",
  "operator",
  "desktop",
  "miloco",
  "knowledge",
] as const;

export type OpenxApiCategory = (typeof OPENX_API_CATEGORIES)[number];

const ADMIN_WRITE_PATHS = [
  "/api/settings",
  "/api/mcp",
  "/api/agents/",
  "/api/model/providers",
  "/api/cli/profiles",
  "/api/skills/bindings",
];

function inferMinTier(endpoint: ApiEndpointDef): OperatorTier {
  if (endpoint.minTier) return endpoint.minTier;
  if (endpoint.auth === "internal") return "operator";
  if (endpoint.method === "GET") return "read";
  if (ADMIN_WRITE_PATHS.some((p) => endpoint.path.startsWith(p) || endpoint.path.includes(p))) {
    return "admin";
  }
  return "operator";
}

function inferConfirmRequired(endpoint: ApiEndpointDef, minTier: OperatorTier): boolean {
  if (endpoint.confirmRequired !== undefined) return endpoint.confirmRequired;
  if (minTier !== "admin") return false;
  return endpoint.method !== "GET";
}

export function enrichApiEndpoint(endpoint: ApiEndpointDef): ApiEndpointDef & {
  minTier: OperatorTier;
  confirmRequired: boolean;
} {
  const minTier = inferMinTier(endpoint);
  const confirmRequired = inferConfirmRequired(endpoint, minTier);
  return { ...endpoint, minTier, confirmRequired };
}

export function enrichApiCatalog(
  endpoints: readonly ApiEndpointDef[],
): Array<ApiEndpointDef & { minTier: OperatorTier; confirmRequired: boolean }> {
  return endpoints.map(enrichApiEndpoint);
}

export const OPENX_API_CATALOG: readonly ApiEndpointDef[] = [
  { id: "health", method: "GET", path: "/api/health", category: "health", summary: "健康检查", auth: "none" },
  {
    id: "events_sse",
    method: "GET",
    path: "/api/events",
    category: "events",
    summary: "SSE 实时事件流（goal/log/coach 等）",
    auth: "none",
    transport: "sse",
    query: { "Last-Event-ID": "断线重连时上次事件 ID" },
    minTier: "read",
  },
  { id: "settings_get", method: "GET", path: "/api/settings", category: "settings", summary: "读取全局设置", auth: "none" },
  {
    id: "settings_put",
    method: "PUT",
    path: "/api/settings",
    category: "settings",
    summary: "更新全局设置（与磁盘 merge，不抹掉未提交的渠道）",
    auth: "none",
    bodyHint: "Settings JSON",
    minTier: "admin",
    confirmRequired: true,
  },
  {
    id: "settings_patch",
    method: "PATCH",
    path: "/api/settings",
    category: "settings",
    summary: "局部更新设置（model/providers/acpCli 等按 key merge）",
    auth: "none",
    bodyHint: "Partial Settings JSON",
    minTier: "operator",
  },
  { id: "workspace_pick", method: "POST", path: "/api/workspace/pick", category: "workspace", summary: "弹出文件夹选择器", auth: "none", minTier: "operator" },
  {
    id: "workspace_open_ide",
    method: "POST",
    path: "/api/workspace/open-in-ide",
    category: "workspace",
    summary: "在 IDE 中打开路径",
    auth: "none",
    bodyHint: "{ path: string }",
    minTier: "operator",
  },
  {
    id: "workspace_file_preview",
    method: "GET",
    path: "/api/workspace/file-preview",
    category: "workspace",
    summary: "工作区文件预览",
    auth: "none",
    query: { path: "相对或绝对路径" },
  },
  { id: "mcp_get", method: "GET", path: "/api/mcp", category: "mcp", summary: "MCP Server 配置与目录", auth: "none" },
  {
    id: "bootstrap_get",
    method: "GET",
    path: "/api/bootstrap",
    category: "system",
    summary: "应用启动快照（设置+项目树+调度台+Persona）",
    auth: "none",
  },
  {
    id: "system_console",
    method: "GET",
    path: "/api/system/console",
    category: "system",
    summary: "调度台快照（连接、统计、跨项目待审）",
    auth: "none",
  },
  {
    id: "island_seen_get",
    method: "GET",
    path: "/api/island/seen",
    category: "system",
    summary: "灵动岛已读 id 列表（按 scope 同步）",
    auth: "none",
    query: { limit: "最多返回条数，默认 500", scopeKey: "设备/用户作用域，默认 global" },
  },
  {
    id: "island_seen_post",
    method: "POST",
    path: "/api/island/seen",
    category: "system",
    summary: "批量标记灵动岛消息已读",
    auth: "none",
    bodyHint: "{ ids: string[], scopeKey?: string }",
  },
  {
    id: "island_attentions_get",
    method: "GET",
    path: "/api/island/attentions",
    category: "system",
    summary: "开放 Attention 列表（durable 待办事实源）",
    auth: "none",
    query: { state: "open", limit: "默认 200" },
    minTier: "read",
  },
  {
    id: "island_attention_ack",
    method: "POST",
    path: "/api/island/attentions/:key/ack",
    category: "system",
    summary: "确认 Attention（知道了）",
    auth: "none",
    pathParams: ["key"],
    minTier: "operator",
  },
  {
    id: "island_push",
    method: "POST",
    path: "/api/system/island/push",
    category: "system",
    summary: "推送灵动岛（internal；目标类 goalId+eventType 或受限 broadcast）",
    auth: "internal",
    bodyHint: "{ goalId, eventType } | { kind:'broadcast', id, title, message }",
    minTier: "operator",
  },
  {
    id: "persistence_health",
    method: "GET",
    path: "/api/system/persistence/health",
    category: "system",
    summary: "本地持久化健康（DB integrity、配置文件、迁移版本）",
    auth: "none",
    minTier: "read",
  },
  {
    id: "persistence_backups_list",
    method: "GET",
    path: "/api/system/persistence/backups",
    category: "system",
    summary: "列出本地备份",
    auth: "none",
    minTier: "read",
  },
  {
    id: "persistence_backup",
    method: "POST",
    path: "/api/system/persistence/backup",
    category: "system",
    summary: "创建 OPENX_HOME 备份",
    auth: "none",
    minTier: "admin",
    confirmRequired: true,
  },
  {
    id: "persistence_export",
    method: "POST",
    path: "/api/system/persistence/export",
    category: "system",
    summary: "导出本地数据归档（同备份）",
    auth: "none",
    minTier: "admin",
    confirmRequired: true,
  },
  {
    id: "persistence_import",
    method: "POST",
    path: "/api/system/persistence/import",
    category: "system",
    summary: "从备份导入（需重启）",
    auth: "none",
    bodyHint: "{ backupId: string }",
    minTier: "admin",
    confirmRequired: true,
  },
  {
    id: "persistence_factory_reset",
    method: "POST",
    path: "/api/system/persistence/factory-reset",
    category: "system",
    summary: "工厂重置本地数据（需 confirm:RESET）",
    auth: "none",
    bodyHint: '{ confirm: "RESET", keepBackups?: boolean }',
    minTier: "admin",
    confirmRequired: true,
  },
  {
    id: "persistence_prune",
    method: "POST",
    path: "/api/system/persistence/prune",
    category: "system",
    summary: "按保留策略裁剪日志/消息/摘要",
    auth: "none",
    minTier: "admin",
  },
  {
    id: "persistence_vacuum",
    method: "POST",
    path: "/api/system/persistence/vacuum",
    category: "system",
    summary: "VACUUM SQLite 回收空间",
    auth: "none",
    minTier: "admin",
  },
  { id: "agents_get", method: "GET", path: "/api/agents", category: "coach", summary: "对话 Agent 目录（AGENT.md）", auth: "none" },
  { id: "agents_get_one", method: "GET", path: "/api/agents/:id", category: "coach", summary: "读取单个 Persona AGENT.md", auth: "none", pathParams: ["id"] },
  {
    id: "agents_put",
    method: "PUT",
    path: "/api/agents/:id",
    category: "coach",
    summary: "写入 Persona AGENT.md",
    auth: "none",
    minTier: "admin",
    confirmRequired: true,
  },
  {
    id: "managed_agents",
    method: "GET",
    path: "/api/managed-agents",
    category: "executors",
    summary: "带在线状态的托管 Agent 列表",
    auth: "none",
  },
  { id: "connect_claim", method: "POST", path: "/api/connect/:connectionId/claim", category: "connect", summary: "原子认领任务池 connect:any 目标", auth: "none", pathParams: ["connectionId"] },
  {
    id: "mcp_put",
    method: "PUT",
    path: "/api/mcp",
    category: "mcp",
    summary: "更新 MCP Server 配置",
    auth: "none",
    bodyHint: "{ servers: McpServerConfig[] }",
    minTier: "admin",
    confirmRequired: true,
  },
  { id: "executors_list", method: "GET", path: "/api/executors", category: "executors", summary: "探测可用执行器", auth: "none" },
  { id: "skills_get", method: "GET", path: "/api/skills", category: "skills", summary: "Skill 目录、绑定与 Agent 列表", auth: "none" },
  {
    id: "skills_bindings_put",
    method: "PUT",
    path: "/api/skills/bindings",
    category: "skills",
    summary: "更新 Skill 绑定",
    auth: "none",
    bodyHint: "SkillBindingsMap",
    minTier: "admin",
    confirmRequired: true,
  },
  { id: "skills_sync", method: "POST", path: "/api/skills/sync", category: "skills", summary: "同步内置 Skills", auth: "none", minTier: "operator" },
  { id: "miloco_status", method: "GET", path: "/api/miloco/status", category: "miloco", summary: "Miloco 集成状态", auth: "none" },
  { id: "miloco_setup", method: "POST", path: "/api/miloco/setup", category: "miloco", summary: "同步 Miloco Skills 并绑定 pi", auth: "none", bodyHint: "{ force?: boolean }" },
  { id: "miloco_webhook", method: "POST", path: "/api/miloco/webhook", category: "miloco", summary: "Miloco 入站 agent webhook（Authorization: Bearer）", auth: "none", bodyHint: "{ action: \"agent\"|\"get_trace\", payload: {...} }" },
  { id: "miloco_webhook_health", method: "GET", path: "/api/miloco/webhook", category: "miloco", summary: "Miloco webhook 健康探针", auth: "none" },
  { id: "catalog_get", method: "GET", path: "/api/catalog", category: "catalog", summary: "本 API 目录（机器可读）", auth: "none" },
  {
    id: "desktop_slots_list",
    method: "GET",
    path: "/api/desktop/slots",
    category: "desktop",
    summary: "读取拓展槽布局、catalog 与模板（slot_list）",
    auth: "none",
    query: { scope: "console | conversation" },
    minTier: "read",
  },
  {
    id: "desktop_slot_create",
    method: "POST",
    path: "/api/desktop/slots",
    category: "desktop",
    summary: "创建拓展槽实例并 Pin（slot_create）",
    auth: "none",
    query: { scope: "console | conversation" },
    bodyHint: "OxspSlotCreateBody",
    minTier: "operator",
  },
  {
    id: "desktop_slot_command",
    method: "POST",
    path: "/api/desktop/slots/:slotId/command",
    category: "desktop",
    summary: "操控拓展槽：pin/unpin/snapshot/navigate/browser_click 等（slot_command）",
    auth: "none",
    pathParams: ["slotId"],
    query: { scope: "console | conversation" },
    bodyHint: "OxspSlotCommandBody",
    minTier: "operator",
  },
  {
    id: "desktop_slot_delete",
    method: "DELETE",
    path: "/api/desktop/slots/:slotId",
    category: "desktop",
    summary: "删除拓展槽实例并取消 Pin",
    auth: "none",
    pathParams: ["slotId"],
    query: { scope: "console | conversation" },
    minTier: "operator",
  },
  {
    id: "desktop_state_put",
    method: "PUT",
    path: "/api/desktop/state",
    category: "desktop",
    summary: "Web 端上行同步桌面状态",
    auth: "none",
    query: { scope: "console | conversation" },
    bodyHint: "{ workspace, catalog }",
    minTier: "operator",
  },
  {
    id: "desktop_browser_frame",
    method: "GET",
    path: "/api/desktop/browser/:sessionId/frame",
    category: "desktop",
    summary: "CDP 浏览器 screencast 帧（JPEG base64）",
    auth: "none",
    pathParams: ["sessionId"],
    query: { startUrl: "optional" },
    minTier: "read",
  },
  {
    id: "desktop_browser_ensure",
    method: "POST",
    path: "/api/desktop/browser/:sessionId/ensure",
    category: "desktop",
    summary: "懒启动 CDP 浏览器会话",
    auth: "none",
    pathParams: ["sessionId"],
    bodyHint: "{ startUrl? }",
    minTier: "operator",
  },
  {
    id: "desktop_browser_ws",
    method: "GET",
    path: "/api/desktop/browser/:sessionId/ws",
    category: "desktop",
    summary: "CDP 浏览器 WebSocket 桥（browserface 协议：推帧 + mousedown/key/scroll）",
    auth: "none",
    pathParams: ["sessionId"],
    query: { startUrl: "optional" },
    minTier: "read",
  },
  {
    id: "desktop_browser_stream",
    method: "GET",
    path: "/api/desktop/browser/:sessionId/stream",
    category: "desktop",
    summary: "browserd 式 SSE 推帧（WebSocket 降级）",
    auth: "none",
    pathParams: ["sessionId"],
    query: { startUrl: "optional" },
    minTier: "read",
  },
  {
    id: "desktop_browser_dom",
    method: "GET",
    path: "/api/desktop/browser/:sessionId/dom",
    category: "desktop",
    summary: "浏览器 DOM 快照（LLM 调试）",
    auth: "none",
    pathParams: ["sessionId"],
    minTier: "read",
  },
  {
    id: "desktop_browser_network",
    method: "GET",
    path: "/api/desktop/browser/:sessionId/network",
    category: "desktop",
    summary: "浏览器最近网络请求（LLM 调试）",
    auth: "none",
    pathParams: ["sessionId"],
    minTier: "read",
  },
  {
    id: "desktop_browser_input",
    method: "POST",
    path: "/api/desktop/browser/:sessionId/input",
    category: "desktop",
    summary: "UI 点击/输入代理到 CDP",
    auth: "none",
    pathParams: ["sessionId"],
    bodyHint: "{ type: click|type, x?, y?, text? }",
    minTier: "operator",
  },
  { id: "operator_playbook", method: "GET", path: "/api/operator/playbook", category: "operator", summary: "OpenX 端到端用法 Playbook", auth: "none", minTier: "read" },
  { id: "operator_workflows", method: "GET", path: "/api/operator/workflows", category: "operator", summary: "可执行 Workflow 列表", auth: "none", minTier: "read" },
  { id: "operator_workflow_run", method: "POST", path: "/api/operator/workflows/:id/run", category: "operator", summary: "运行内置 Workflow", auth: "none", pathParams: ["id"], bodyHint: "{ vars?, stopOnError? }", minTier: "read" },
  { id: "operator_actions_list", method: "GET", path: "/api/operator/actions", category: "operator", summary: "待确认 operator 写操作", auth: "none", minTier: "read" },
  {
    id: "operator_action_confirm",
    method: "POST",
    path: "/api/operator/actions/:id/confirm",
    category: "operator",
    summary: "确认并执行待审 operator 写操作",
    auth: "none",
    pathParams: ["id"],
    minTier: "admin",
  },
  {
    id: "operator_action_dismiss",
    method: "POST",
    path: "/api/operator/actions/:id/dismiss",
    category: "operator",
    summary: "取消待审 operator 写操作",
    auth: "none",
    pathParams: ["id"],
    minTier: "admin",
  },
  {
    id: "operator_self_test",
    method: "POST",
    path: "/api/operator/self-test",
    category: "operator",
    summary: "运行确定性自举 E2E 断言链",
    auth: "none",
    minTier: "operator",
  },
  { id: "projects_list", method: "GET", path: "/api/projects", category: "projects", summary: "项目与对话列表", auth: "none" },
  { id: "projects_create", method: "POST", path: "/api/projects", category: "projects", summary: "创建项目", auth: "none", bodyHint: "CreateProjectInput" },
  { id: "projects_get", method: "GET", path: "/api/projects/:id", category: "projects", summary: "项目详情", auth: "none", pathParams: ["id"] },
  { id: "projects_patch", method: "PATCH", path: "/api/projects/:id", category: "projects", summary: "更新项目", auth: "none", pathParams: ["id"], bodyHint: "UpdateProjectInput" },
  { id: "projects_delete", method: "DELETE", path: "/api/projects/:id", category: "projects", summary: "删除项目", auth: "none", pathParams: ["id"] },
  { id: "projects_memory", method: "GET", path: "/api/projects/:id/memory", category: "projects", summary: "读取项目运行知识 MEMORY.md", auth: "none", pathParams: ["id"] },
  { id: "projects_memory_distill", method: "POST", path: "/api/projects/:id/memory/distill", category: "projects", summary: "蒸馏项目经验到运行知识", auth: "none", pathParams: ["id"] },
  { id: "projects_knowledge_list", method: "GET", path: "/api/projects/:id/knowledge", category: "projects", summary: "读取项目用户知识 + 运行知识摘要", auth: "none", pathParams: ["id"] },
  { id: "projects_knowledge_create", method: "POST", path: "/api/projects/:id/knowledge/entries", category: "projects", summary: "添加项目用户知识条目", auth: "none", pathParams: ["id"], bodyHint: "CreateKnowledgeEntryInput" },
  { id: "projects_knowledge_patch", method: "PATCH", path: "/api/projects/:id/knowledge/entries/:entryId", category: "projects", summary: "更新项目用户知识条目", auth: "none", pathParams: ["id", "entryId"], bodyHint: "UpdateKnowledgeEntryInput" },
  { id: "projects_knowledge_delete", method: "DELETE", path: "/api/projects/:id/knowledge/entries/:entryId", category: "projects", summary: "删除项目用户知识条目", auth: "none", pathParams: ["id", "entryId"] },
  { id: "knowledge_global_list", method: "GET", path: "/api/knowledge/global", category: "knowledge", summary: "读取全局知识条目", auth: "none" },
  { id: "knowledge_global_create", method: "POST", path: "/api/knowledge/global/entries", category: "knowledge", summary: "添加全局知识条目", auth: "none", bodyHint: "CreateKnowledgeEntryInput" },
  { id: "knowledge_global_patch", method: "PATCH", path: "/api/knowledge/global/entries/:entryId", category: "knowledge", summary: "更新全局知识条目", auth: "none", pathParams: ["entryId"], bodyHint: "UpdateKnowledgeEntryInput" },
  { id: "knowledge_global_delete", method: "DELETE", path: "/api/knowledge/global/entries/:entryId", category: "knowledge", summary: "删除全局知识条目", auth: "none", pathParams: ["entryId"] },
  { id: "knowledge_search", method: "GET", path: "/api/knowledge/search", category: "knowledge", summary: "跨层检索知识", auth: "none", query: { q: "关键词", projectId: "项目 ID", scopes: "user,runtime,global" } },
  { id: "knowledge_health", method: "GET", path: "/api/knowledge/health", category: "knowledge", summary: "知识索引健康检查", auth: "none" },
  { id: "knowledge_rebuild", method: "POST", path: "/api/knowledge/rebuild", category: "knowledge", summary: "重建知识索引", auth: "none", query: { projectId: "可选项目 ID", embed: "1 时等待 embedding" } },
  { id: "knowledge_promote", method: "POST", path: "/api/knowledge/promote", category: "knowledge", summary: "提升知识（user→global 或 runtime→user）", auth: "none", query: { projectId: "项目 ID" }, bodyHint: "PromoteKnowledgeInput" },
  { id: "knowledge_save", method: "POST", path: "/api/knowledge/save", category: "knowledge", summary: "Coach 保存项目用户知识", auth: "none", bodyHint: "SaveKnowledgeInput" },
  { id: "conversations_create", method: "POST", path: "/api/projects/:id/conversations", category: "conversations", summary: "创建对话", auth: "none", pathParams: ["id"], bodyHint: "{ title?: string }" },
  { id: "conversations_get", method: "GET", path: "/api/conversations/:id", category: "conversations", summary: "对话详情", auth: "none", pathParams: ["id"] },
  { id: "conversations_patch", method: "PATCH", path: "/api/conversations/:id", category: "conversations", summary: "更新对话标题", auth: "none", pathParams: ["id"], bodyHint: "{ title: string }" },
  { id: "conversations_delete", method: "DELETE", path: "/api/conversations/:id", category: "conversations", summary: "删除对话", auth: "none", pathParams: ["id"] },
  { id: "goals_recommend_executor", method: "POST", path: "/api/goals/recommend-executor", category: "goals", summary: "推荐执行器", auth: "none", bodyHint: "RecommendExecutorInput" },
  { id: "goals_list", method: "GET", path: "/api/goals", category: "goals", summary: "目标列表", auth: "none", query: { status: "过滤状态", conversationId: "对话 ID", projectId: "项目 ID" } },
  { id: "goals_create", method: "POST", path: "/api/goals", category: "goals", summary: "创建目标（含 Coach refine）", auth: "none", bodyHint: "CreateGoalInput + autoStart?" },
  { id: "goals_get", method: "GET", path: "/api/goals/:id", category: "goals", summary: "目标详情、日志与运行态", auth: "none", pathParams: ["id"] },
  { id: "goals_run", method: "GET", path: "/api/goals/:id/run", category: "goals", summary: "目标运行态", auth: "none", pathParams: ["id"] },
  { id: "goals_children", method: "GET", path: "/api/goals/:id/children", category: "goals", summary: "子目标列表", auth: "none", pathParams: ["id"] },
  {
    id: "goals_review_rounds",
    method: "GET",
    path: "/api/goals/:id/review-rounds",
    category: "goals",
    summary: "审查轮次历史",
    auth: "none",
    pathParams: ["id"],
  },
  {
    id: "goals_trigger_review",
    method: "POST",
    path: "/api/goals/:id/trigger-review",
    category: "goals",
    summary: "手动触发审查",
    auth: "none",
    pathParams: ["id"],
  },
  { id: "goals_patch", method: "PATCH", path: "/api/goals/:id", category: "goals", summary: "更新目标", auth: "none", pathParams: ["id"], bodyHint: "UpdateGoalInput" },
  { id: "goals_refine", method: "POST", path: "/api/goals/:id/refine", category: "goals", summary: "Coach 重新整理目标", auth: "none", pathParams: ["id"] },
  { id: "goals_start", method: "POST", path: "/api/goals/:id/start", category: "goals", summary: "启动执行", auth: "none", pathParams: ["id"] },
  { id: "goals_retry", method: "POST", path: "/api/goals/:id/retry", category: "goals", summary: "失败重试", auth: "none", pathParams: ["id"] },
  { id: "goals_approve", method: "POST", path: "/api/goals/:id/approve", category: "goals", summary: "验收通过", auth: "none", pathParams: ["id"] },
  { id: "goals_approval_gate", method: "GET", path: "/api/goals/:id/approval-gate", category: "goals", summary: "查询完成门禁状态", auth: "none", pathParams: ["id"] },
  { id: "goals_waive", method: "POST", path: "/api/goals/:id/waive", category: "goals", summary: "豁免子任务", auth: "none", pathParams: ["id"] },
  { id: "goals_rework", method: "POST", path: "/api/goals/:id/rework", category: "goals", summary: "返工", auth: "none", pathParams: ["id"], bodyHint: "{ reason?: string }" },
  { id: "goals_cancel", method: "POST", path: "/api/goals/:id/cancel", category: "goals", summary: "取消", auth: "none", pathParams: ["id"] },
  { id: "goals_delete", method: "DELETE", path: "/api/goals/:id", category: "goals", summary: "删除目标", auth: "none", pathParams: ["id"] },
  { id: "goals_sub_goals", method: "POST", path: "/api/goals/:id/sub-goals", category: "goals", summary: "添加子目标", auth: "none", pathParams: ["id"], bodyHint: "{ subGoals, autoStart? }" },
  { id: "goals_batch", method: "POST", path: "/api/goals/batch", category: "goals", summary: "批量 start/cancel/approve/delete", auth: "none", bodyHint: "{ action, ids }" },
  { id: "coach_providers", method: "GET", path: "/api/coach/providers", category: "coach", summary: "Coach LLM 模板列表", auth: "none" },
  { id: "coach_status", method: "GET", path: "/api/coach/status", category: "coach", summary: "Coach 运行时状态", auth: "none" },
  { id: "coach_test", method: "POST", path: "/api/coach/test", category: "coach", summary: "测试 Coach 连接", auth: "none", minTier: "operator" },
  { id: "coach_refine", method: "POST", path: "/api/coach/refine", category: "coach", summary: "整理用户草稿为结构化目标", auth: "none", bodyHint: "RefineInput" },
  { id: "coach_messages", method: "GET", path: "/api/coach/messages", category: "coach", summary: "对话历史", auth: "none", query: { conversationId: "对话 ID" } },
  { id: "coach_chat", method: "POST", path: "/api/coach/chat", category: "coach", summary: "Coach 对话", auth: "none", bodyHint: "CoachChatInput（含 mcpIds/agentId/skillIds）" },
  {
    id: "coach_refined_respond",
    method: "POST",
    path: "/api/coach/refined/:messageId/respond",
    category: "coach",
    summary: "任务单确认/取消",
    auth: "none",
    pathParams: ["messageId"],
    bodyHint: "RefinedWorkOrderRespond",
  },
  {
    id: "coach_clarify_respond",
    method: "POST",
    path: "/api/coach/clarify/:messageId/respond",
    category: "coach",
    summary: "澄清卡作答/跳过",
    auth: "none",
    pathParams: ["messageId"],
    bodyHint: "CoachClarifyRespond",
  },
  { id: "model_templates", method: "GET", path: "/api/model/templates", category: "model", summary: "LLM 渠道模板", auth: "none" },
  { id: "model_providers_get", method: "GET", path: "/api/model/providers", category: "model", summary: "已配置渠道", auth: "none" },
  {
    id: "model_providers_create",
    method: "POST",
    path: "/api/model/providers",
    category: "model",
    summary: "新增渠道",
    auth: "none",
    bodyHint: "{ slug, config }",
    minTier: "admin",
    confirmRequired: true,
  },
  {
    id: "model_providers_update",
    method: "PUT",
    path: "/api/model/providers/:slug",
    category: "model",
    summary: "更新渠道",
    auth: "none",
    pathParams: ["slug"],
    bodyHint: "ProviderConfig",
    minTier: "admin",
    confirmRequired: true,
  },
  {
    id: "model_providers_delete",
    method: "DELETE",
    path: "/api/model/providers/:slug",
    category: "model",
    summary: "删除渠道",
    auth: "none",
    pathParams: ["slug"],
    minTier: "admin",
    confirmRequired: true,
  },
  { id: "model_status", method: "GET", path: "/api/model/status", category: "model", summary: "Coach/Pi 模型运行时", auth: "none" },
  { id: "model_fetch_models", method: "POST", path: "/api/model/fetch-models", category: "model", summary: "拉取远程模型列表", auth: "none", bodyHint: "{ slug? | config? }", minTier: "operator" },
  { id: "model_test", method: "POST", path: "/api/model/test", category: "model", summary: "测试模型连接", auth: "none", bodyHint: "{ ref?, role?, slug?, config? }", minTier: "operator" },
  { id: "cli_acp_config_get", method: "GET", path: "/api/cli/acp-config/:executorId", category: "cli", summary: "读取 ACP CLI 配置快照", auth: "none", pathParams: ["executorId"] },
  {
    id: "cli_acp_config_put",
    method: "PUT",
    path: "/api/cli/acp-config/:executorId",
    category: "cli",
    summary: "同步 ACP CLI 模型配置",
    auth: "none",
    pathParams: ["executorId"],
    bodyHint: "{ modelRef }",
    minTier: "admin",
    confirmRequired: true,
  },
  { id: "cli_templates", method: "GET", path: "/api/cli/templates", category: "cli", summary: "CLI 接入模板", auth: "none" },
  {
    id: "cli_profiles_create",
    method: "POST",
    path: "/api/cli/profiles",
    category: "cli",
    summary: "添加 CLI/Connect 配置",
    auth: "none",
    bodyHint: "CliProfile",
    minTier: "admin",
    confirmRequired: true,
  },
  {
    id: "cli_profiles_delete",
    method: "DELETE",
    path: "/api/cli/profiles/:executorId",
    category: "cli",
    summary: "删除 CLI 配置",
    auth: "none",
    pathParams: ["executorId"],
    minTier: "admin",
    confirmRequired: true,
  },
  { id: "cli_bootstrap_get", method: "GET", path: "/api/cli/profiles/:executorId/bootstrap", category: "cli", summary: "获取 Connect 自举命令", auth: "none", pathParams: ["executorId"] },
  { id: "cli_bootstrap_post", method: "POST", path: "/api/cli/profiles/:executorId/bootstrap", category: "cli", summary: "一键自举 Connect Agent", auth: "none", pathParams: ["executorId"], minTier: "operator" },
  {
    id: "cli_system_conversation",
    method: "GET",
    path: "/api/cli/system-conversation",
    category: "cli",
    summary: "CLI 集成系统对话",
    auth: "none",
  },
  {
    id: "cli_knowledge_health",
    method: "GET",
    path: "/api/cli/knowledge/health",
    category: "cli",
    summary: "CLI 读取知识索引健康状态",
    auth: "none",
  },
  {
    id: "cli_knowledge_rebuild",
    method: "POST",
    path: "/api/cli/knowledge/rebuild",
    category: "cli",
    summary: "CLI 重建知识索引",
    auth: "none",
    query: { projectId: "可选项目 ID", embed: "1 时等待 embedding" },
  },
  {
    id: "cli_bootstrap_status",
    method: "GET",
    path: "/api/cli/bootstrap-status",
    category: "cli",
    summary: "Connect 自举进程状态",
    auth: "none",
  },
  { id: "connect_register", method: "POST", path: "/api/connect", category: "connect", summary: "注册 Connect Agent（返回 internalToken 与回调 URL）", auth: "none", bodyHint: "ConnectInput" },
  { id: "connect_heartbeat", method: "POST", path: "/api/connect/:connectionId/heartbeat", category: "connect", summary: "心跳并拉取待办目标", auth: "none", pathParams: ["connectionId"], bodyHint: "HeartbeatInput" },
  { id: "connect_disconnect", method: "DELETE", path: "/api/connect/:connectionId", category: "connect", summary: "断开连接", auth: "none", pathParams: ["connectionId"] },
  { id: "connect_disconnect_by_executor", method: "DELETE", path: "/api/connect/by-executor/:executorId", category: "connect", summary: "按 executorId 断开", auth: "none", pathParams: ["executorId"] },
  { id: "internal_progress", method: "POST", path: "/internal/goals/:id/progress", category: "internal", summary: "更新执行进度", auth: "internal", pathParams: ["id"], bodyHint: "{ progress: 0-100, message? }" },
  { id: "internal_complete", method: "POST", path: "/internal/goals/:id/complete", category: "internal", summary: "标记完成", auth: "internal", pathParams: ["id"], bodyHint: "{ resultSummary?, deliverables? }" },
  { id: "internal_fail", method: "POST", path: "/internal/goals/:id/fail", category: "internal", summary: "标记失败", auth: "internal", pathParams: ["id"], bodyHint: "{ errorMessage? }" },
  { id: "internal_run_event", method: "POST", path: "/internal/goals/:id/run-event", category: "internal", summary: "推送运行事件 delta", auth: "internal", pathParams: ["id"], bodyHint: "RunDeltaEvent" },
  { id: "internal_log", method: "POST", path: "/internal/goals/:id/log", category: "internal", summary: "写入执行日志", auth: "internal", pathParams: ["id"], bodyHint: "{ level?, message }" },
] as const;

export function listApiCatalog(opts?: {
  category?: string;
  tier?: OperatorTier;
}): Array<ApiEndpointDef & { minTier: OperatorTier; confirmRequired: boolean }> {
  let all = enrichApiCatalog(OPENX_API_CATALOG);
  if (opts?.category) {
    all = all.filter((e) => e.category === opts.category);
  }
  if (opts?.tier && opts.tier !== "off") {
    all = all.filter((e) => tierSatisfies(opts.tier!, e.minTier));
  }
  return all;
}

export function findCatalogEndpoint(
  method: string,
  path: string,
): (ApiEndpointDef & { minTier: OperatorTier; confirmRequired: boolean }) | undefined {
  const normalizedPath = path.split("?")[0] ?? path;
  const m = method.toUpperCase();
  for (const ep of enrichApiCatalog(OPENX_API_CATALOG)) {
    if (ep.method !== m) continue;
    const pattern = ep.path.replace(/:[^/]+/g, "[^/]+");
    const re = new RegExp(`^${pattern}$`);
    if (re.test(normalizedPath)) return ep;
  }
  return undefined;
}

export function getApiCatalogMeta() {
  return {
    version: OPENX_API_VERSION,
    endpointCount: OPENX_API_CATALOG.length,
    categories: [...OPENX_API_CATEGORIES],
    defaultBaseUrl: "http://127.0.0.1:3921",
    mcpServerId: "openx",
    authNotes: {
      public: "GET 与无 Origin 的 POST/PUT/PATCH/DELETE 可直接调用",
      internal: "需请求头 x-openx-internal-token（见 POST /api/connect 或 ~/.openx/internal.token）",
      sse: "/api/events 为 SSE 长连接，不可用普通 JSON 请求模拟",
      operator:
        "operatorTier: off|read|operator|admin；admin 写操作 confirmRequired 须 UI 确认",
    },
  };
}

export function buildApiCatalogResponse() {
  return {
    meta: getApiCatalogMeta(),
    endpoints: listApiCatalog(),
  };
}
