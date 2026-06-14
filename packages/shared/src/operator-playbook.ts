import type { OperatorTier } from "./operator-tier.js";

export type OperatorPlaybookStep = {
  id: string;
  title: string;
  summary: string;
  apis: string[];
};

export type OperatorPlaybookFlow = {
  id: string;
  title: string;
  description: string;
  steps: OperatorPlaybookStep[];
};

export type OperatorPlaybook = {
  version: string;
  product: string;
  baseUrl: string;
  minTierForTools: OperatorTier;
  concepts: string[];
  flows: OperatorPlaybookFlow[];
  selfTestStepIds: string[];
  toolHints: string[];
};

export function buildOperatorPlaybook(baseUrl = "http://127.0.0.1:3921"): OperatorPlaybook {
  return {
    version: "0.1.0",
    product: "OpenX",
    baseUrl,
    minTierForTools: "read",
    concepts: [
      "OpenX 是工头层 Agent 控制台：项目/对话/目标看板 + Coach + 多执行器派单",
      "全部 REST API 可通过 GET /api/catalog 或 openx MCP 工具发现",
      "工头 operatorTier>=read 时可使用 openx_list_apis / openx_call_api 原生工具",
      "admin 级写 settings/model/cli/mcp/agents 须 propose_operator_action 并经用户确认",
      "/api/events 为 SSE，不可经 openx_call_api；用 GET /api/bootstrap 或轮询 goals 代替",
    ],
    flows: [
      {
        id: "onboard_connect",
        title: "添加 Connect Agent",
        description: "注册 CliProfile → bootstrap → 验证 executors 在线",
        steps: [
          {
            id: "cli_profile_create",
            title: "写入 Connect CliProfile",
            summary: "POST /api/cli/profiles（kind=connect）",
            apis: ["POST /api/cli/profiles"],
          },
          {
            id: "cli_bootstrap",
            title: "一键自举 connect-client",
            summary: "POST /api/cli/profiles/:executorId/bootstrap body { wait: true }",
            apis: ["POST /api/cli/profiles/:executorId/bootstrap"],
          },
          {
            id: "verify_executors",
            title: "验证在线",
            summary: "GET /api/executors 直到 executorId available=true",
            apis: ["GET /api/executors", "GET /api/cli/bootstrap-status"],
          },
        ],
      },
      {
        id: "add_model",
        title: "添加模型渠道",
        description: "创建 provider → 绑定 coach/pi → 测试连接",
        steps: [
          {
            id: "model_provider_create",
            title: "新增 LLM Provider",
            summary: "POST /api/model/providers（admin，需确认）",
            apis: ["POST /api/model/providers"],
          },
          {
            id: "settings_model_bind",
            title: "绑定 Coach/Pi 模型",
            summary: "PUT /api/settings 更新 model.coach / model.pi（admin，需确认）",
            apis: ["PUT /api/settings"],
          },
          {
            id: "model_test",
            title: "测试连接",
            summary: "POST /api/model/test 或 POST /api/coach/test",
            apis: ["POST /api/model/test", "POST /api/coach/test"],
          },
        ],
      },
      {
        id: "goal_lifecycle",
        title: "目标端到端",
        description: "项目 → 对话 → Coach 任务单 → 启动 → 验收",
        steps: [
          {
            id: "project_conversation",
            title: "创建项目与对话",
            summary: "POST /api/projects → POST /api/projects/:id/conversations",
            apis: ["POST /api/projects", "POST /api/projects/:id/conversations"],
          },
          {
            id: "coach_work_order",
            title: "Coach 出任务单",
            summary: "POST /api/coach/chat → POST /api/coach/refined/:id/respond",
            apis: ["POST /api/coach/chat", "POST /api/coach/refined/:messageId/respond"],
          },
          {
            id: "goal_dispatch",
            title: "创建并启动目标",
            summary: "POST /api/goals autoStart 或 POST /api/goals/:id/start",
            apis: ["POST /api/goals", "POST /api/goals/:id/start"],
          },
          {
            id: "goal_review",
            title: "验收",
            summary: "GET /api/goals/:id → POST approve 或 trigger-review",
            apis: [
              "GET /api/goals/:id",
              "POST /api/goals/:id/approve",
              "POST /api/goals/:id/trigger-review",
            ],
          },
        ],
      },
      {
        id: "incident_response",
        title: "生产事故响应",
        description: "告警 → 只读侦察 → 修复验证 → 工头验收 → 灵动岛通知",
        steps: [
          {
            id: "triage_goal",
            title: "创建事故 Goal",
            summary: "Coach 整理两阶段 subGoals（侦察 read_only + 修复），派 acp:claude 或 pi",
            apis: ["POST /api/coach/chat", "POST /api/goals"],
          },
          {
            id: "crew_foreman",
            title: "工头↔施工队对话",
            summary: "施工队 crew-question → 工头 directive；查看 GET /api/goals/:id/crew-messages",
            apis: ["GET /api/goals/:id/crew-messages", "GET /api/goals/:id"],
          },
          {
            id: "review_and_island",
            title: "自动审查与灵动岛",
            summary: "awaiting_review 时 trigger-review；失败推 island；用户 approve/rework",
            apis: [
              "POST /api/goals/:id/trigger-review",
              "POST /api/goals/:id/approve",
              "POST /api/goals/:id/rework",
            ],
          },
        ],
      },
      {
        id: "client_delivery",
        title: "客户交付 / 演示环境",
        description: "多对话项目 → 任务单确认 → 指定 executor/agent → 验收门禁",
        steps: [
          {
            id: "project_setup",
            title: "项目与工作区隔离",
            summary: "POST /api/projects 绑定 workspaceDir；每客户独立 conversation",
            apis: ["POST /api/projects", "POST /api/projects/:id/conversations"],
          },
          {
            id: "work_order_gate",
            title: "任务单与澄清闭环",
            summary: "模糊需求走 clarify；明确需求 forceRefine；用户确认 refined 后再派单",
            apis: [
              "POST /api/coach/chat",
              "POST /api/coach/clarify/:id/respond",
              "POST /api/coach/refined/:messageId/respond",
            ],
          },
          {
            id: "approval_gate",
            title: "批准门禁",
            summary: "子任务未完成 / 澄清 pending / 审查未 pass 时 approve 返回 400 + 灵动岛 gate_blocked",
            apis: ["POST /api/goals/:id/approve", "GET /api/goals/:id"],
          },
        ],
      },
    ],
    selfTestStepIds: [
      "catalog_health",
      "catalog_complete",
      "project_create",
      "conversation_create",
      "goal_mock_lifecycle",
      "operator_read_get",
      "operator_admin_pending",
    ],
    toolHints: [
      "先 openx_get_catalog 或 openx_list_apis 了解接口，再 openx_call_api",
      "path 支持 :id 占位，用 pathParams 传入",
      "admin 写操作返回 pendingActionId，须等用户确认后再继续",
    ],
  };
}
