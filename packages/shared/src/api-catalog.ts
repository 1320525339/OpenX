/** OpenX REST API 机器可读目录 — Agent / MCP 自举用 */

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
] as const;

export type OpenxApiCategory = (typeof OPENX_API_CATEGORIES)[number];

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
  },
  { id: "settings_get", method: "GET", path: "/api/settings", category: "settings", summary: "读取全局设置", auth: "none" },
  { id: "settings_put", method: "PUT", path: "/api/settings", category: "settings", summary: "更新全局设置", auth: "none", bodyHint: "Settings JSON" },
  { id: "workspace_pick", method: "POST", path: "/api/workspace/pick", category: "workspace", summary: "弹出文件夹选择器", auth: "none" },
  { id: "workspace_open_ide", method: "POST", path: "/api/workspace/open-in-ide", category: "workspace", summary: "在 IDE 中打开路径", auth: "none", bodyHint: "{ path: string }" },
  { id: "mcp_get", method: "GET", path: "/api/mcp", category: "mcp", summary: "MCP Server 配置与目录", auth: "none" },
  { id: "bootstrap_get", method: "GET", path: "/api/bootstrap", category: "system", summary: "应用启动快照（设置+项目树+调度台+Persona）", auth: "none" },
  { id: "agents_get", method: "GET", path: "/api/agents", category: "coach", summary: "对话 Agent 目录（AGENT.md）", auth: "none" },
  { id: "agents_get_one", method: "GET", path: "/api/agents/:id", category: "coach", summary: "读取单个 Persona AGENT.md", auth: "none" },
  { id: "agents_put", method: "PUT", path: "/api/agents/:id", category: "coach", summary: "写入 Persona AGENT.md", auth: "none" },
  { id: "connect_claim", method: "POST", path: "/api/connect/:connectionId/claim", category: "connect", summary: "原子认领任务池 connect:any 目标", auth: "none" },
  { id: "mcp_put", method: "PUT", path: "/api/mcp", category: "mcp", summary: "更新 MCP Server 配置", auth: "none", bodyHint: "{ servers: McpServerConfig[] }" },
  { id: "executors_list", method: "GET", path: "/api/executors", category: "executors", summary: "探测可用执行器", auth: "none" },
  { id: "skills_get", method: "GET", path: "/api/skills", category: "skills", summary: "Skill 目录、绑定与 Agent 列表", auth: "none" },
  { id: "skills_bindings_put", method: "PUT", path: "/api/skills/bindings", category: "skills", summary: "更新 Skill 绑定", auth: "none", bodyHint: "SkillBindingsMap" },
  { id: "skills_sync", method: "POST", path: "/api/skills/sync", category: "skills", summary: "同步内置 Skills", auth: "none" },
  { id: "catalog_get", method: "GET", path: "/api/catalog", category: "catalog", summary: "本 API 目录（机器可读）", auth: "none" },
  { id: "projects_list", method: "GET", path: "/api/projects", category: "projects", summary: "项目与对话列表", auth: "none" },
  { id: "projects_create", method: "POST", path: "/api/projects", category: "projects", summary: "创建项目", auth: "none", bodyHint: "CreateProjectInput" },
  { id: "projects_get", method: "GET", path: "/api/projects/:id", category: "projects", summary: "项目详情", auth: "none", pathParams: ["id"] },
  { id: "projects_patch", method: "PATCH", path: "/api/projects/:id", category: "projects", summary: "更新项目", auth: "none", pathParams: ["id"], bodyHint: "UpdateProjectInput" },
  { id: "projects_delete", method: "DELETE", path: "/api/projects/:id", category: "projects", summary: "删除项目", auth: "none", pathParams: ["id"] },
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
  { id: "goals_patch", method: "PATCH", path: "/api/goals/:id", category: "goals", summary: "更新目标", auth: "none", pathParams: ["id"], bodyHint: "UpdateGoalInput" },
  { id: "goals_refine", method: "POST", path: "/api/goals/:id/refine", category: "goals", summary: "Coach 重新整理目标", auth: "none", pathParams: ["id"] },
  { id: "goals_start", method: "POST", path: "/api/goals/:id/start", category: "goals", summary: "启动执行", auth: "none", pathParams: ["id"] },
  { id: "goals_retry", method: "POST", path: "/api/goals/:id/retry", category: "goals", summary: "失败重试", auth: "none", pathParams: ["id"] },
  { id: "goals_approve", method: "POST", path: "/api/goals/:id/approve", category: "goals", summary: "验收通过", auth: "none", pathParams: ["id"] },
  { id: "goals_rework", method: "POST", path: "/api/goals/:id/rework", category: "goals", summary: "返工", auth: "none", pathParams: ["id"], bodyHint: "{ reason?: string }" },
  { id: "goals_cancel", method: "POST", path: "/api/goals/:id/cancel", category: "goals", summary: "取消", auth: "none", pathParams: ["id"] },
  { id: "goals_delete", method: "DELETE", path: "/api/goals/:id", category: "goals", summary: "删除目标", auth: "none", pathParams: ["id"] },
  { id: "goals_sub_goals", method: "POST", path: "/api/goals/:id/sub-goals", category: "goals", summary: "添加子目标", auth: "none", pathParams: ["id"], bodyHint: "{ subGoals, autoStart? }" },
  { id: "goals_batch", method: "POST", path: "/api/goals/batch", category: "goals", summary: "批量 start/cancel/approve/delete", auth: "none", bodyHint: "{ action, ids }" },
  { id: "coach_providers", method: "GET", path: "/api/coach/providers", category: "coach", summary: "Coach LLM 模板列表", auth: "none" },
  { id: "coach_status", method: "GET", path: "/api/coach/status", category: "coach", summary: "Coach 运行时状态", auth: "none" },
  { id: "coach_test", method: "POST", path: "/api/coach/test", category: "coach", summary: "测试 Coach 连接", auth: "none" },
  { id: "coach_refine", method: "POST", path: "/api/coach/refine", category: "coach", summary: "整理用户草稿为结构化目标", auth: "none", bodyHint: "RefineInput" },
  { id: "coach_messages", method: "GET", path: "/api/coach/messages", category: "coach", summary: "对话历史", auth: "none", query: { conversationId: "对话 ID" } },
  { id: "coach_chat", method: "POST", path: "/api/coach/chat", category: "coach", summary: "Coach 对话", auth: "none", bodyHint: "CoachChatInput（含 mcpIds/agentId/skillIds）" },
  { id: "model_templates", method: "GET", path: "/api/model/templates", category: "model", summary: "LLM 渠道模板", auth: "none" },
  { id: "model_providers_get", method: "GET", path: "/api/model/providers", category: "model", summary: "已配置渠道", auth: "none" },
  { id: "model_providers_create", method: "POST", path: "/api/model/providers", category: "model", summary: "新增渠道", auth: "none", bodyHint: "{ slug, config }" },
  { id: "model_providers_update", method: "PUT", path: "/api/model/providers/:slug", category: "model", summary: "更新渠道", auth: "none", pathParams: ["slug"], bodyHint: "ProviderConfig" },
  { id: "model_providers_delete", method: "DELETE", path: "/api/model/providers/:slug", category: "model", summary: "删除渠道", auth: "none", pathParams: ["slug"] },
  { id: "model_status", method: "GET", path: "/api/model/status", category: "model", summary: "Coach/Pi 模型运行时", auth: "none" },
  { id: "model_fetch_models", method: "POST", path: "/api/model/fetch-models", category: "model", summary: "拉取远程模型列表", auth: "none", bodyHint: "{ slug? | config? }" },
  { id: "model_test", method: "POST", path: "/api/model/test", category: "model", summary: "测试模型连接", auth: "none", bodyHint: "{ ref?, role?, slug?, config? }" },
  { id: "cli_acp_config_get", method: "GET", path: "/api/cli/acp-config/:executorId", category: "cli", summary: "读取 ACP CLI 配置快照", auth: "none", pathParams: ["executorId"] },
  { id: "cli_acp_config_put", method: "PUT", path: "/api/cli/acp-config/:executorId", category: "cli", summary: "同步 ACP CLI 模型配置", auth: "none", pathParams: ["executorId"], bodyHint: "{ modelRef }" },
  { id: "cli_templates", method: "GET", path: "/api/cli/templates", category: "cli", summary: "CLI 接入模板", auth: "none" },
  { id: "cli_profiles_create", method: "POST", path: "/api/cli/profiles", category: "cli", summary: "添加 CLI/Connect 配置", auth: "none", bodyHint: "CliProfile" },
  { id: "cli_profiles_delete", method: "DELETE", path: "/api/cli/profiles/:executorId", category: "cli", summary: "删除 CLI 配置", auth: "none", pathParams: ["executorId"] },
  { id: "cli_bootstrap_get", method: "GET", path: "/api/cli/profiles/:executorId/bootstrap", category: "cli", summary: "获取 Connect 自举命令", auth: "none", pathParams: ["executorId"] },
  { id: "cli_bootstrap_post", method: "POST", path: "/api/cli/profiles/:executorId/bootstrap", category: "cli", summary: "一键自举 Connect Agent", auth: "none", pathParams: ["executorId"] },
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

export function listApiCatalog(opts?: { category?: string }): ApiEndpointDef[] {
  const all = [...OPENX_API_CATALOG];
  if (!opts?.category) return all;
  return all.filter((e) => e.category === opts.category);
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
    },
  };
}

export function buildApiCatalogResponse() {
  return {
    meta: getApiCatalogMeta(),
    endpoints: listApiCatalog(),
  };
}
