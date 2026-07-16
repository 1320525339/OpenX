import type { GoalStatus } from "./goal.js";
import type { SkillBindingsMap } from "./skills.js";

/** Miloco Dashboard 默认地址（WSL 服务需监听 0.0.0.0 或配置端口转发） */
export const MILOCO_DASHBOARD_URL = "http://127.0.0.1:1810/";

/** OpenX 默认 API 端口 */
export const MILOCO_DEFAULT_PORT = 3921;

/** Miloco 入站 webhook 路径（挂载于 OpenX API） */
export const MILOCO_WEBHOOK_PATH = "/api/miloco/webhook";

/** Webhook Bearer 鉴权环境变量 */
export const OPENX_MILOCO_WEBHOOK_TOKEN_ENV = "OPENX_MILOCO_WEBHOOK_TOKEN";

/** Miloco 感知事件专用系统会话 ID */
export const MILOCO_EVENTS_CONVERSATION_ID = "openx-miloco-events";

/** Miloco 家庭 Cron 专用系统会话 ID */
export const MILOCO_CRON_CONVERSATION_ID = "openx-miloco-cron";

/** OpenX 侧 Miloco 感知记忆目录（Pi 写 memory/*.md） */
export const MILOCO_MEMORY_DIR_NAME = "miloco-memory";

/** 家庭 Cron watchdog 环境变量 */
export const OPENX_MILOCO_HOME_CRON_WATCH_ENV = "OPENX_MILOCO_HOME_CRON_WATCH";

/** 家庭 Cron 轮询间隔（检查是否触发）默认 60s */
export const DEFAULT_MILOCO_HOME_CRON_TICK_MS = 60_000;
export const OPENX_MILOCO_HOME_CRON_TICK_ENV = "OPENX_MILOCO_HOME_CRON_TICK_MS";

/** Miloco agent turn 状态（与 Miloco 后端契约一致） */
export type MilocoTurnStatus = "ok" | "error" | "timeout";

/** Miloco get_trace 状态 */
export type MilocoTraceStatus = "done" | "in_progress" | "unknown";

/** OpenX 拓展槽 Miloco 面板模板 ID */
export const MILOCO_OXSP_TEMPLATE_ID = "miloco-dashboard";

/** 首批启用的 Miloco Skills（低风险：查询/控制/运维） */
export const MILOCO_BATCH1_SKILL_IDS = [
  "miloco-devices",
  "miloco-miot-scope",
  "miloco-miot-admin",
] as const;

/** 第二批 Miloco Skills（任务/感知/身份） */
export const MILOCO_BATCH2_SKILL_IDS = [
  "miloco-create-task",
  "miloco-terminate-task",
  "miloco-perception",
  "miloco-miot-identity",
  "miloco-miot-identity-register",
] as const;

/** 批次二新增 Skills（不含已在 proactive 中的 miloco-perception） */
export const MILOCO_BATCH2_ONLY_SKILL_IDS = [
  "miloco-create-task",
  "miloco-terminate-task",
  "miloco-miot-identity",
  "miloco-miot-identity-register",
] as const;

/** 主动事件闭环所需 Skills（batch1 + 播报 + 感知上下文） */
export const MILOCO_PROACTIVE_SKILL_IDS = [
  ...MILOCO_BATCH1_SKILL_IDS,
  "miloco-notify",
  "miloco-perception",
] as const;

/** 批次三 Miloco Skills（家庭档案 / 巡检 / 习惯） */
export const MILOCO_BATCH3_SKILL_IDS = [
  "miloco-home-profile",
  "miloco-perception-digest",
  "miloco-home-patrol",
  "miloco-home-observe",
  "miloco-home-promote",
  "miloco-home-prune",
  "miloco-habit-suggest",
] as const;

/** 批次三新增 Skills（与 proactive/batch2 无重复） */
export const MILOCO_BATCH3_ONLY_SKILL_IDS = [...MILOCO_BATCH3_SKILL_IDS] as const;

/** OpenX 同步安装并绑定 pi 的全部 Miloco Skills（proactive + batch2 + batch3，共 16 个） */
export const MILOCO_SYNC_SKILL_IDS = [
  ...MILOCO_PROACTIVE_SKILL_IDS,
  ...MILOCO_BATCH2_ONLY_SKILL_IDS,
  ...MILOCO_BATCH3_ONLY_SKILL_IDS,
] as const;

export const MILOCO_SKILL_REPO_LABEL = "miloco-local";

/** 构建 Miloco webhook 完整 URL */
export function milocoWebhookUrl(
  host = "127.0.0.1",
  port = MILOCO_DEFAULT_PORT,
): string {
  return `http://${host}:${port}${MILOCO_WEBHOOK_PATH}`;
}

/** lane → 人类可读事件标签 */
export function laneToEventLabel(lane: string): string {
  switch (lane) {
    case "miloco-interactive":
      return "语音/交互";
    case "miloco-rule":
      return "规则触发";
    case "miloco-suggest":
      return "感知建议";
    default:
      return lane || "未知事件";
  }
}

/** Goal 终态 → Miloco agent turn status */
export function mapGoalStatusToTurnStatus(status: GoalStatus): MilocoTurnStatus {
  if (status === "awaiting_review" || status === "done") return "ok";
  if (status === "failed" || status === "cancelled") return "error";
  return "timeout";
}

/** Goal 状态 → Miloco get_trace status */
export function mapGoalStatusToTraceStatus(status: GoalStatus): MilocoTraceStatus {
  if (status === "awaiting_review" || status === "done") return "done";
  if (status === "running" || status === "draft") return "in_progress";
  return "unknown";
}

/** Windows 侧调用 miloco-cli 的统一前缀（OpenX/Pi 在 shell 中执行） */
export function milocoCliCommandPrefix(openxRepoRoot: string): string {
  const normalized = openxRepoRoot.replace(/\\/g, "/");
  return `powershell -NoProfile -ExecutionPolicy Bypass -File "${normalized}/scripts/miloco-wsl.ps1"`;
}

/** OpenX miloco 记忆目录：OPENX_HOME/miloco-memory，否则 ~/.openx/miloco-memory */
export function milocoOpenxMemoryDir(userHome?: string): string {
  const fromEnv = process.env.OPENX_HOME?.trim();
  if (fromEnv) {
    return `${fromEnv.replace(/\\/g, "/").replace(/\/$/, "")}/${MILOCO_MEMORY_DIR_NAME}`;
  }
  const home = (userHome || process.env.USERPROFILE || process.env.HOME || "")
    .replace(/\\/g, "/")
    .replace(/\/$/, "");
  return `${home}/.openx/${MILOCO_MEMORY_DIR_NAME}`;
}

/** 为 Pi 注入的 Miloco 执行环境说明 */
export function milocoOpenxExecutionPreamble(openxRepoRoot: string): string {
  const prefix = milocoCliCommandPrefix(openxRepoRoot);
  const memoryDir = milocoOpenxMemoryDir();
  const apiBase = `http://127.0.0.1:${MILOCO_DEFAULT_PORT}`;
  return [
    "【Miloco · OpenX 执行约定】",
    `- 所有 miloco-cli 命令必须通过 WSL 包装执行：${prefix} <子命令...>`,
    "- 示例：",
    `  ${prefix} service status`,
    `  ${prefix} device list`,
    `  ${prefix} device control <did> on true`,
    "- Miloco 服务未运行时先执行：",
    `  ${prefix} service start`,
    "- 若返回连接失败，检查 WSL 中 miloco-cli 是否已安装、服务是否在运行。",
    "- 设备控制类操作涉及多台设备或危险动作时，必须先向用户确认。",
    "",
    "【感知记忆文件】",
    `- 工作目录：${memoryDir}`,
    `- 感知摘要：${memoryDir}/memory/YYYY-MM-DD-miloco-perception.md`,
    `- 交互记忆：${memoryDir}/memory/YYYY-MM-DD.md`,
    "- 写文件前确保 memory 子目录存在。",
    "",
    "【OpenX 习惯建议 API】",
    `- 替代 miloco_habit_suggest 工具：curl -s -X POST ${apiBase}/api/miloco/habit-suggest -H "Content-Type: application/json" -d '{"action":"list"}'`,
    `- 替代 miloco_im_push：${prefix} notify push --text "<消息>"`,
    "",
    "【家庭 Cron】",
    "- 定时任务由 OpenX miloco-home-cron-watchdog 触发（需 OPENX_MILOCO_HOME_CRON_WATCH=1）",
    "- Cron Goal 在会话 openx-miloco-cron 中执行",
  ].join("\n");
}

/** 设备在线监测：单次状态变化 */
export type MilocoPresenceChange = {
  did: string;
  name: string;
  from: boolean;
  to: boolean;
};

/** 设备在线监测配置（~/.openx/miloco-presence.json） */
export type MilocoPresenceConfig = {
  homeId?: string;
  watchDids: string[];
  notifyOn: Array<"online" | "offline">;
};

/** 设备在线监测持久化状态 */
export type MilocoPresenceState = {
  baselineReady: boolean;
  lastPollAt?: string;
  devices: Record<string, { online: boolean; name?: string }>;
};

/** 默认监测设备 did（空：由用户配置 / 接入向导填写） */
export const DEFAULT_MILOCO_PRESENCE_WATCH_DIDS: readonly string[] = [];

/** 默认轮询间隔：5 分钟 */
export const DEFAULT_MILOCO_PRESENCE_INTERVAL_MS = 300_000;

export const OPENX_MILOCO_PRESENCE_WATCH_ENV = "OPENX_MILOCO_PRESENCE_WATCH";
export const OPENX_MILOCO_PRESENCE_INTERVAL_ENV = "OPENX_MILOCO_PRESENCE_INTERVAL_MS";

/** lane 能力策略：skills + 权限模式 */
export type MilocoLanePolicy = {
  skillIds: readonly string[];
  permissionMode: "read_only" | "ask_write" | "full";
  /** 成功后自动验收，不进入待验收队列 */
  autoComplete: boolean;
  /** 是否默认升级为需人工确认的 Goal */
  escalateByDefault: boolean;
};

const INTERACTIVE_SKILLS = [
  "miloco-devices",
  "miloco-miot-scope",
  "miloco-miot-admin",
  "miloco-notify",
  "miloco-perception",
] as const;

const SUGGEST_SKILLS = [
  "miloco-devices",
  "miloco-miot-scope",
  "miloco-notify",
  "miloco-perception",
  "miloco-habit-suggest",
  "miloco-home-profile",
] as const;

const RULE_SKILLS = [
  "miloco-devices",
  "miloco-miot-scope",
  "miloco-miot-admin",
  "miloco-notify",
  "miloco-perception",
  "miloco-create-task",
] as const;

/** 危险能力：默认不注入；仅升级 Goal 时按需加入 */
export const MILOCO_DANGEROUS_SKILL_IDS = [
  "miloco-terminate-task",
  "miloco-miot-identity",
  "miloco-miot-identity-register",
  "miloco-home-prune",
  "miloco-home-promote",
] as const;

export function resolveMilocoLanePolicy(lane: string): MilocoLanePolicy {
  switch (lane) {
    case "miloco-interactive":
      return {
        skillIds: INTERACTIVE_SKILLS,
        permissionMode: "ask_write",
        autoComplete: true,
        escalateByDefault: false,
      };
    case "miloco-suggest":
      return {
        skillIds: SUGGEST_SKILLS,
        permissionMode: "read_only",
        autoComplete: true,
        escalateByDefault: false,
      };
    case "miloco-rule":
      return {
        skillIds: RULE_SKILLS,
        permissionMode: "ask_write",
        autoComplete: true,
        escalateByDefault: false,
      };
    default:
      return {
        skillIds: INTERACTIVE_SKILLS,
        permissionMode: "ask_write",
        autoComplete: true,
        escalateByDefault: false,
      };
  }
}

/** 服务端校验：请求的 skill 是否在 lane 白名单（或危险升级集）内 */
export function milocoSkillAllowedForLane(
  lane: string,
  skillId: string,
  opts?: { escalate?: boolean },
): boolean {
  const policy = resolveMilocoLanePolicy(lane);
  if (policy.skillIds.includes(skillId as (typeof policy.skillIds)[number])) {
    return true;
  }
  if (opts?.escalate && (MILOCO_DANGEROUS_SKILL_IDS as readonly string[]).includes(skillId)) {
    return true;
  }
  return false;
}

/** 从事件文本启发式判断是否需要人工确认 */
export function milocoMessageNeedsEscalation(message: string): boolean {
  const text = message.toLowerCase();
  const patterns = [
    /删除/,
    /全部.*设备/,
    /所有.*设备/,
    /多台/,
    /身份注册/,
    /terminate/,
    /prune/,
    /不可逆/,
    /清空/,
  ];
  return patterns.some((re) => re.test(text));
}

/** 默认将 Miloco Skills 绑定给 pi */
export function defaultMilocoSkillBindings(
  existing: SkillBindingsMap = {},
): SkillBindingsMap {
  const out: SkillBindingsMap = { ...existing };
  for (const id of MILOCO_SYNC_SKILL_IDS) {
    const prev = out[id];
    out[id] = {
      enabled: prev?.enabled ?? true,
      cliIds: prev?.cliIds?.length ? prev.cliIds : ["pi"],
    };
  }
  return out;
}
