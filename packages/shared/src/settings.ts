import { z } from "zod";
import { ExecutorIdSchema } from "./goal.js";
import { CoachSettingsSchema } from "./coach-settings.js";
import {
  createDefaultModelSection,
  createDefaultProvidersMap,
  ModelSectionSchema,
  ProvidersMapSchema,
} from "./model-config.js";
import { CliProfileSchema } from "./cli-profiles.js";
import { AcpCliBindingsSchema } from "./acp-cli-config.js";
import { SkillBindingsMapSchema } from "./skills.js";
import { McpServersSchema } from "./mcp.js";
import { OperatorTierSchema } from "./operator-tier.js";
import { LlmContextSettingsSchema } from "./llm-context-config.js";

/** 单个集成的用户设置 */
export const IntegrationUserSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** 旧配置迁移是否已执行（只迁一次） */
  migrationCompleted: z.boolean().default(false),
  /** 插件私有配置（家庭、设备、Dashboard URL 等） */
  config: z.record(z.string(), z.unknown()).default({}),
});
export type IntegrationUserSettings = z.infer<typeof IntegrationUserSettingsSchema>;

export const IntegrationsMapSchema = z
  .record(z.string(), IntegrationUserSettingsSchema)
  .default({});
export type IntegrationsMap = z.infer<typeof IntegrationsMapSchema>;

export const PiExecutorSettingsSchema = z.object({
  /** 可选：内嵌 Pi 底座 provider */
  provider: z.string().optional(),
  /** 可选：内嵌 Pi 底座 model（支持 provider/model） */
  model: z.string().optional(),
  /** 可选：pi --session-dir，默认由 OpenX 数据目录管理 */
  sessionDir: z.string().optional(),
  /** 单次目标最长运行时间（毫秒） */
  runTimeoutMs: z.number().int().min(30_000).max(3_600_000).default(600_000),
  /** 目标执行使用独立会话，不污染 Pi 全局 session */
  noSession: z.boolean().default(true),
  /** 单轮最多工具调用次数，超出后中止并汇报（防 Pi 死循环，默认 50） */
  maxToolCalls: z.number().int().min(1).max(100).optional(),
  /** 沙箱配置（首期仅配置+日志，执行隔离后续迭代） */
  sandbox: z
    .object({
      enabled: z.boolean().default(false),
      type: z.enum(["docker", "devcontainer"]).default("docker"),
      image: z.string().optional(),
      allowedPaths: z.array(z.string()).optional(),
    })
    .optional(),
});
export type PiExecutorSettings = z.infer<typeof PiExecutorSettingsSchema>;

/** ACP 执行器沙箱/无人值守默认（配置层） */
export const AcpExecutorSettingsSchema = z.object({
  sandbox: z
    .object({
      enabled: z.boolean().default(false),
      type: z.enum(["docker", "devcontainer"]).default("docker"),
      image: z.string().optional(),
      allowedPaths: z.array(z.string()).optional(),
    })
    .optional(),
  /** 默认无人值守（仅 desktop-local 建议开启） */
  defaultSkipPermissions: z.boolean().default(false),
});
export type AcpExecutorSettings = z.infer<typeof AcpExecutorSettingsSchema>;

/** Pi 单轮默认工具调用上限（与 executor-pi 一致） */
export const DEFAULT_PI_MAX_TOOL_CALLS = 50;

export const SettingsSchema = z.object({
  defaultExecutorId: ExecutorIdSchema.default("pi"),
  /** @deprecated 请使用 systemWorkspaceRoot；读时作迁移回退 */
  workspaceRoot: z.string().default("."),
  /** 调度台 / 系统任务 / Skills·MCP 链接使用的工程工作目录 */
  systemWorkspaceRoot: z.string().default(""),
  defaultConstraints: z.array(z.string()).default([]),
  /** 各角色当前模型引用 slug/modelId */
  model: ModelSectionSchema.default(createDefaultModelSection),
  /** 用户配置的 LLM 渠道池 */
  providers: ProvidersMapSchema.default(createDefaultProvidersMap),
  /** @deprecated 读时兼容，写时剥离；请使用 model + providers */
  coach: CoachSettingsSchema.optional(),
  executors: z
    .object({
      pi: PiExecutorSettingsSchema.default({}),
      acp: AcpExecutorSettingsSchema.default({}),
    })
    .default({}),
  notifyOnComplete: z.boolean().default(true),
  /** 新建主/子任务是否立即 publish 启动 */
  autoExecute: z.boolean().default(true),
  /** 依赖满足后是否自动启动 draft 子任务（默认与历史行为一致） */
  autoStartDependents: z.boolean().default(true),
  /** 验收失败是否自动返工 / 生成修补子任务（默认与历史行为一致） */
  autoRework: z.boolean().default(true),
  /** 添加 Connect CLI 后自动调用 bootstrap API */
  autoBootstrapConnect: z.boolean().default(true),
  /** 用户添加的 CLI / Connect Agent 配置 */
  cliProfiles: z.array(CliProfileSchema).default([]),
  /** ACP CLI（Codex / Claude）绑定的项目渠道与模型 */
  acpCli: AcpCliBindingsSchema,
  /** Skill 启用与 executor 分配（服务端持久化，多 Agent 共用） */
  skillBindings: SkillBindingsMapSchema.default({}),
  /** MCP Server 注册表（派单时传给 ACP 施工队） */
  mcpServers: McpServersSchema,
  /** 工头 Coach 调用 OpenX API 的权限分级 */
  operatorTier: OperatorTierSchema.default("off"),
  /** LLM 上下文与 system prompt 段落配置（时区、locale、段落覆盖） */
  llmContext: LlmContextSettingsSchema.optional(),
  /** 第三方集成启用状态与私有配置 */
  integrations: IntegrationsMapSchema,
  /** 乐观锁：每次持久化递增，PUT/PATCH 可带 baseRevision 防陈旧覆盖 */
  revision: z.number().int().nonnegative().default(0),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

/** 解析 OPENX_MILOCO 类开关：显式 0/1 覆盖设置 */
export function parseIntegrationEnvFlag(
  raw: string | undefined,
): boolean | undefined {
  if (raw === undefined || raw === "") return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  if (v === "1" || v === "true" || v === "on") return true;
  return undefined;
}