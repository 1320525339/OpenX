import { z } from "zod";
import { KnowledgeContextSelectionSchema } from "./knowledge.js";
import { DispatchPermissionModeSchema } from "./dispatch-context.js";
import {
  DEFAULT_MODEL_REF,
  ModelRefSchema,
  listConfiguredModelRefs,
} from "./model-config.js";

/** 圆桌会话模式 */
export const ConversationModeSchema = z.enum(["foreman", "roundtable"]);
export type ConversationMode = z.infer<typeof ConversationModeSchema>;

export const ROUNDTABLE_ALL_PARTICIPANTS_ID = "__all__";

export const AiCapabilityIdSchema = z.enum(["knowledge", "browser", "mcp"]);
export type AiCapabilityId = z.infer<typeof AiCapabilityIdSchema>;

export const AiProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  avatar: z.string().optional(),
  description: z.string(),
  rolePrompt: z.string().min(1),
  modelRef: ModelRefSchema,
  defaultCapabilityIds: z.array(AiCapabilityIdSchema).default([]),
  builtin: z.boolean(),
});
export type AiProfile = z.infer<typeof AiProfileSchema>;

export const CreateAiProfileSchema = z.object({
  name: z.string().min(1),
  avatar: z.string().optional(),
  description: z.string().default(""),
  rolePrompt: z.string().min(1),
  modelRef: ModelRefSchema.optional(),
  defaultCapabilityIds: z.array(AiCapabilityIdSchema).default([]),
});
export type CreateAiProfileInput = z.infer<typeof CreateAiProfileSchema>;

export const UpdateAiProfileSchema = z.object({
  name: z.string().min(1).optional(),
  avatar: z.string().optional(),
  description: z.string().optional(),
  rolePrompt: z.string().min(1).optional(),
  modelRef: ModelRefSchema.optional(),
  defaultCapabilityIds: z.array(AiCapabilityIdSchema).optional(),
});
export type UpdateAiProfileInput = z.infer<typeof UpdateAiProfileSchema>;

export const ConversationParticipantSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  profileId: z.string().min(1),
  displayName: z.string().min(1),
  modelRef: ModelRefSchema,
  enabled: z.boolean(),
  capabilityIds: z.array(AiCapabilityIdSchema).default([]),
  sortOrder: z.number().int(),
});
export type ConversationParticipant = z.infer<typeof ConversationParticipantSchema>;

export const UpsertConversationParticipantsSchema = z.object({
  participants: z.array(
    z.object({
      id: z.string().min(1).optional(),
      profileId: z.string().min(1),
      displayName: z.string().min(1).optional(),
      modelRef: ModelRefSchema.optional(),
      enabled: z.boolean().optional(),
      capabilityIds: z.array(AiCapabilityIdSchema).optional(),
      sortOrder: z.number().int().optional(),
    }),
  ),
});
export type UpsertConversationParticipantsInput = z.infer<
  typeof UpsertConversationParticipantsSchema
>;

/** 圆桌席位双向配置：Agent（profileId）× 模型（modelRef） */
export const RoundtableSeatInputSchema = z.object({
  profileId: z.string().min(1),
  modelRef: ModelRefSchema.optional(),
  displayName: z.string().min(1).optional(),
});
export type RoundtableSeatInput = z.infer<typeof RoundtableSeatInputSchema>;

export const EnableRoundtableSchema = z.object({
  participantProfileIds: z.array(z.string().min(1)).optional(),
  participantSeats: z.array(RoundtableSeatInputSchema).optional(),
});
export type EnableRoundtableInput = z.infer<typeof EnableRoundtableSchema>;

/** 通用席位画像 id（先选模型再挂 Agent 时的默认画像） */
export const ROUNDTABLE_GENERAL_PROFILE_ID = "general";

export const ChatRoundModeSchema = z.enum(["direct", "diverge"]);
export type ChatRoundMode = z.infer<typeof ChatRoundModeSchema>;

export const ChatRoundStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "partial",
  "failed",
  "cancelled",
]);
export type ChatRoundStatus = z.infer<typeof ChatRoundStatusSchema>;

export const PeerRequestStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "auto_approved",
  "cancelled",
]);
export type PeerRequestStatus = z.infer<typeof PeerRequestStatusSchema>;

export const PeerRequestSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  roundId: z.string().optional(),
  fromParticipantId: z.string().min(1),
  toParticipantId: z.string().min(1),
  fromDisplayName: z.string().min(1),
  toDisplayName: z.string().min(1),
  question: z.string().min(1),
  status: PeerRequestStatusSchema,
  messageId: z.number().int().optional(),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
});
export type PeerRequest = z.infer<typeof PeerRequestSchema>;

export const PeerMentionGrantSchema = z.object({
  conversationId: z.string().min(1),
  fromParticipantId: z.string().min(1),
  toParticipantId: z.string().min(1),
  createdAt: z.string(),
});
export type PeerMentionGrant = z.infer<typeof PeerMentionGrantSchema>;

/** 线程卡片载荷（存 coach_messages.meta_json） */
export const PeerRequestPayloadSchema = PeerRequestSchema;
export type PeerRequestPayload = PeerRequest;

export const ChatRoundOutputGoalSchema = z.enum([
  "ideas",
  "plans",
  "risks",
  "counterexamples",
  "free",
]);
export type ChatRoundOutputGoal = z.infer<typeof ChatRoundOutputGoalSchema>;

export const ChatRoundLengthSchema = z.enum(["short", "medium", "long"]);
export type ChatRoundLength = z.infer<typeof ChatRoundLengthSchema>;

/** 圆桌发送时 Composer 选中的 Context 快照（与 CoachChatInput 对齐） */
export const ChatRoundComposerContextSchema = z.object({
  skillIds: z.array(z.string()).optional(),
  mcpIds: z.array(z.string()).optional(),
  knowledge: KnowledgeContextSelectionSchema.optional(),
  permissionMode: DispatchPermissionModeSchema.optional(),
});
export type ChatRoundComposerContext = z.infer<typeof ChatRoundComposerContextSchema>;

export const ChatRoundSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  sourceMessageId: z.number().int().optional(),
  mode: ChatRoundModeSchema,
  participantIds: z.array(z.string()),
  synthesize: z.boolean(),
  status: ChatRoundStatusSchema,
  estimatedCalls: z.number().int().nonnegative(),
  outputGoal: ChatRoundOutputGoalSchema.optional(),
  length: ChatRoundLengthSchema.optional(),
  /** 本轮发送时的 Skill/MCP/知识/权限快照 */
  composerContext: ChatRoundComposerContextSchema.optional(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
});
export type ChatRound = z.infer<typeof ChatRoundSchema>;

export const CreateChatRoundSchema = z.object({
  message: z.string().min(1),
  mode: ChatRoundModeSchema.default("direct"),
  mentionParticipantIds: z.array(z.string()).default([]),
  sourceMessageId: z.number().int().optional(),
  synthesize: z.boolean().optional(),
  outputGoal: ChatRoundOutputGoalSchema.optional(),
  length: ChatRoundLengthSchema.optional(),
  skillIds: z.array(z.string()).optional(),
  mcpIds: z.array(z.string()).optional(),
  knowledge: KnowledgeContextSelectionSchema.optional(),
  permissionMode: DispatchPermissionModeSchema.optional(),
});
export type CreateChatRoundInput = z.infer<typeof CreateChatRoundSchema>;

/** 从创建入参提取可持久化的 Composer 快照 */
export function pickChatRoundComposerContext(
  input: Pick<
    CreateChatRoundInput,
    "skillIds" | "mcpIds" | "knowledge" | "permissionMode"
  >,
): ChatRoundComposerContext | undefined {
  const skillIds = input.skillIds?.filter((id) => id.trim()) ?? [];
  const mcpIds = input.mcpIds?.filter((id) => id.trim()) ?? [];
  const hasKnowledge = input.knowledge != null;
  const hasPermission = input.permissionMode != null;
  if (skillIds.length === 0 && mcpIds.length === 0 && !hasKnowledge && !hasPermission) {
    return undefined;
  }
  return {
    ...(skillIds.length > 0 ? { skillIds } : {}),
    ...(mcpIds.length > 0 ? { mcpIds } : {}),
    ...(hasKnowledge ? { knowledge: input.knowledge } : {}),
    ...(hasPermission ? { permissionMode: input.permissionMode } : {}),
  };
}

export const SpeakerTypeSchema = z.enum(["user", "foreman", "participant"]);
export type SpeakerType = z.infer<typeof SpeakerTypeSchema>;

export const GenerationStatusSchema = z.enum([
  "pending",
  "streaming",
  "completed",
  "failed",
  "cancelled",
]);
export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;

export const GenerationMetaSchema = z.object({
  modelRef: ModelRefSchema.optional(),
  profileId: z.string().optional(),
  error: z.string().optional(),
});
export type GenerationMeta = z.infer<typeof GenerationMetaSchema>;

export const RoundSynthesisPayloadSchema = z.object({
  roundId: z.string().min(1),
  consensus: z.string(),
  disagreements: z.string(),
  recommendation: z.string(),
  nextSteps: z.string(),
});
export type RoundSynthesisPayload = z.infer<typeof RoundSynthesisPayloadSchema>;

/** 单轮回复生成路数硬上限（不含工头总结） */
export const ROUNDTABLE_MAX_PARALLEL_REPLIES = 6;
/** 默认建议并行数 */
export const ROUNDTABLE_DEFAULT_PARALLEL_REPLIES = 3;

/** 工头固定 profile id（圆桌席位，对应 FOREMAN_AGENT_ID 语义） */
export const ROUNDTABLE_FOREMAN_PROFILE_ID = "foreman";

export const BUILTIN_AI_PROFILES: AiProfile[] = [
  {
    id: ROUNDTABLE_FOREMAN_PROFILE_ID,
    name: "工头助手",
    avatar: "👷",
    description: "主持对话、追问、总结、生成任务单",
    rolePrompt:
      "你是 OpenX 工头助手，负责主持圆桌讨论：追问澄清、归纳共识与分歧、给出可执行下一步，并在用户要求时整理成任务单。不要替施工队写代码。",
    modelRef: DEFAULT_MODEL_REF,
    defaultCapabilityIds: ["knowledge"],
    builtin: true,
  },
  {
    id: ROUNDTABLE_GENERAL_PROFILE_ID,
    name: "通用席位",
    avatar: "🤖",
    description: "轻量通用发言席，可再换成具体角色画像",
    rolePrompt:
      "你是圆桌通用席位。基于当前议题给出清晰、可执行的观点，标明假设与不确定处。不要冒充工头，不要生成任务单。",
    modelRef: DEFAULT_MODEL_REF,
    defaultCapabilityIds: [],
    builtin: true,
  },
  {
    id: "product",
    name: "产品策略师",
    avatar: "📐",
    description: "用户价值、范围、优先级、MVP",
    rolePrompt:
      "你是产品策略师。聚焦用户价值、问题定义、范围边界、优先级与 MVP。用简洁结构化观点发言，避免空泛口号。",
    modelRef: DEFAULT_MODEL_REF,
    defaultCapabilityIds: [],
    builtin: true,
  },
  {
    id: "architect",
    name: "技术架构师",
    avatar: "🏗️",
    description: "技术方案、系统边界、可实现性",
    rolePrompt:
      "你是技术架构师。评估技术方案、系统边界、依赖、可实现性与演进成本。观点要具体，指出假设与风险。",
    modelRef: DEFAULT_MODEL_REF,
    defaultCapabilityIds: ["knowledge"],
    builtin: true,
  },
  {
    id: "designer",
    name: "交互设计师",
    avatar: "✏️",
    description: "页面结构、操作流程、状态反馈",
    rolePrompt:
      "你是交互设计师。关注信息架构、操作流程、状态反馈与可用性。用场景化描述说明体验建议。",
    modelRef: DEFAULT_MODEL_REF,
    defaultCapabilityIds: [],
    builtin: true,
  },
  {
    id: "critic",
    name: "风险审查员",
    avatar: "🔍",
    description: "找漏洞、反例、成本和风险",
    rolePrompt:
      "你是风险审查员。主动找漏洞、反例、成本与合规风险。批评要具体可验证，并给出缓解建议。",
    modelRef: DEFAULT_MODEL_REF,
    defaultCapabilityIds: [],
    builtin: true,
  },
  {
    id: "creative",
    name: "创意发散者",
    avatar: "💡",
    description: "提供非常规方向和替代方案",
    rolePrompt:
      "你是创意发散者。提供非常规方向与替代方案，鼓励探索但标明可行性假设。避免与他人雷同的套话。",
    modelRef: DEFAULT_MODEL_REF,
    defaultCapabilityIds: [],
    builtin: true,
  },
  {
    id: "researcher",
    name: "项目研究员",
    avatar: "📚",
    description: "搜索资料、竞品与事实核查",
    rolePrompt:
      "你是项目研究员。侧重事实核查、竞品与资料要点。没有证据时明确说不确定，不要编造链接或数据。",
    modelRef: DEFAULT_MODEL_REF,
    defaultCapabilityIds: ["knowledge", "browser"],
    builtin: true,
  },
];

/** 新建圆桌默认阵容 profile ids */
export const DEFAULT_ROUNDTABLE_PROFILE_IDS = [
  ROUNDTABLE_FOREMAN_PROFILE_ID,
  "product",
  "architect",
  "critic",
] as const;

/** 从设置拼出圆桌模型池：coach → default → 其余已配置模型（去重） */
export function buildRoundtableModelPool(settings: {
  model?: { coach?: string; default?: string; pi?: string; reviewer?: string };
  providers?: Parameters<typeof listConfiguredModelRefs>[0]["providers"];
}): string[] {
  const coach = settings.model?.coach?.trim() || DEFAULT_MODEL_REF;
  const def = settings.model?.default?.trim() || coach;
  const pool: string[] = [];
  const push = (ref?: string) => {
    const r = ref?.trim();
    if (r && !pool.includes(r)) pool.push(r);
  };
  push(coach);
  push(def);
  push(settings.model?.pi);
  push(settings.model?.reviewer);
  for (const { ref } of listConfiguredModelRefs({ providers: settings.providers ?? {} })) {
    push(ref);
  }
  if (pool.length === 0) pool.push(DEFAULT_MODEL_REF);
  return pool;
}

/** modelRef 短名（UI chip）：取 `/` 后段，过长则截断 */
export function shortModelRefLabel(modelRef: string, maxLen = 18): string {
  const raw = modelRef.includes("/") ? modelRef.slice(modelRef.indexOf("/") + 1) : modelRef;
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, maxLen - 1)}…`;
}

export function speakerTypeToLegacyRole(
  speakerType: SpeakerType,
): "user" | "coach" {
  return speakerType === "user" ? "user" : "coach";
}

export function legacyRoleToSpeakerType(
  role: string,
): SpeakerType {
  if (role === "user") return "user";
  return "foreman";
}
