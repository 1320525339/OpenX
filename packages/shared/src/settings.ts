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
import { SkillBindingsMapSchema } from "./skills.js";

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
});
export type PiExecutorSettings = z.infer<typeof PiExecutorSettingsSchema>;

export const SettingsSchema = z.object({
  defaultExecutorId: ExecutorIdSchema.default("pi"),
  workspaceRoot: z.string().default("."),
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
    })
    .default({}),
  notifyOnComplete: z.boolean().default(true),
  autoExecute: z.boolean().default(true),
  /** 用户添加的 CLI / Connect Agent 配置 */
  cliProfiles: z.array(CliProfileSchema).default([]),
  /** Skill 启用与 executor 分配（服务端持久化，多 Agent 共用） */
  skillBindings: SkillBindingsMapSchema.default({}),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});
