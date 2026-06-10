import {
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { EXECUTOR_AUTO, isValidExecutorId, type ModelSettingsSlice, type PiExecutorSettings } from "@openx/shared";
import { createPiModelRegistry, resolvePiModel } from "./model.js";
import { mergePiSettingsFromModel } from "./pi-bridge.js";
import { createOpenxResourceLoader } from "./pi-resource-loader.js";

export type ExecutorCandidate = {
  id: string;
  label: string;
  hint?: string;
  available: boolean;
};

export type PickExecutorInput = {
  title: string;
  acceptance: string;
  executionPrompt: string;
  workspaceRoot: string;
  candidates: ExecutorCandidate[];
  settings: {
    pi?: PiExecutorSettings;
    model?: ModelSettingsSlice["model"];
    providers?: ModelSettingsSlice["providers"];
  };
};

const ROUTER_SYSTEM = `你是 OpenX 执行器路由。根据任务内容，从候选列表中选出最合适的一个 executorId。
只回复 JSON：{"executorId":"..."}，不要 markdown 或其它文字。
优先规则：
- 本地代码/文件/仓库操作 → pi
- 需要特定 CLI（Gemini/Codex/Claude）→ 对应 acp:*
- 已在线 Connect Agent 且任务适合外部工具 → 该 Connect executorId
- 不确定 → pi`;

function resolvePiSettings(settings: PickExecutorInput["settings"]): PiExecutorSettings {
  const base = settings.pi ?? { runTimeoutMs: 120_000, noSession: true };
  return mergePiSettingsFromModel(base, {
    model: settings.model,
    providers: settings.providers,
  });
}

function parseExecutorChoice(text: string, candidates: ExecutorCandidate[]): string | null {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed) as { executorId?: string };
    if (parsed.executorId && isValidExecutorId(parsed.executorId) && parsed.executorId !== EXECUTOR_AUTO) {
      return parsed.executorId;
    }
  } catch {
    /* fall through */
  }
  const match = trimmed.match(/executorId["\s:]+([a-z][a-z0-9_:-]*)/i);
  if (match?.[1] && isValidExecutorId(match[1]) && match[1] !== EXECUTOR_AUTO) {
    return match[1];
  }
  const ids = new Set(candidates.filter((c) => c.available).map((c) => c.id));
  for (const id of ids) {
    if (trimmed.includes(id)) return id;
  }
  return null;
}

function fallbackExecutor(candidates: ExecutorCandidate[]): string {
  const available = candidates.filter((c) => c.available && c.id !== EXECUTOR_AUTO);
  const pi = available.find((c) => c.id === "pi");
  if (pi) return "pi";
  return available[0]?.id ?? "pi";
}

/** 用 Pi 内嵌底座为 auto 目标选择 executorId */
export async function pickExecutorWithPi(input: PickExecutorInput): Promise<string> {
  const available = input.candidates.filter((c) => c.available && c.id !== EXECUTOR_AUTO);
  if (available.length === 0) return "pi";
  if (available.length === 1) return available[0]!.id;

  const pi = resolvePiSettings(input.settings);
  const { authStorage, modelRegistry } = await createPiModelRegistry({
    model: input.settings.model,
    providers: input.settings.providers,
  });
  const { model, error: modelError } = await resolvePiModel(pi, modelRegistry);
  if (modelError) return fallbackExecutor(input.candidates);

  const candidateBlock = available
    .map((c) => `- ${c.id}: ${c.label}${c.hint ? `（${c.hint}）` : ""}`)
    .join("\n");

  const userPrompt = [
    `任务标题：${input.title}`,
    `验收标准：${input.acceptance}`,
    `执行说明：${input.executionPrompt.slice(0, 1200)}`,
    "",
    "候选执行器：",
    candidateBlock,
    "",
    '请输出 {"executorId":"..."}',
  ].join("\n");

  let session;
  try {
    const resourceLoader = await createOpenxResourceLoader(input.workspaceRoot);
    const created = await createAgentSession({
      cwd: input.workspaceRoot,
      authStorage,
      modelRegistry,
      sessionManager: SessionManager.inMemory(input.workspaceRoot),
      ...(model ? { model } : {}),
      ...(resourceLoader ? { resourceLoader } : {}),
    });
    session = created.session;
    await session.prompt(`${ROUTER_SYSTEM}\n\n${userPrompt}`);
    const lastAssistant = [...session.state.messages]
      .reverse()
      .find((m) => m.role === "assistant");
    const text =
      typeof lastAssistant?.content === "string"
        ? lastAssistant.content
        : Array.isArray(lastAssistant?.content)
          ? lastAssistant.content
              .map((b) => (typeof b === "object" && b && "text" in b ? String(b.text) : ""))
              .join("")
          : "";
    const picked = parseExecutorChoice(text, input.candidates);
    if (picked && available.some((c) => c.id === picked)) return picked;
    return fallbackExecutor(input.candidates);
  } catch {
    return fallbackExecutor(input.candidates);
  } finally {
    session?.dispose();
  }
}
