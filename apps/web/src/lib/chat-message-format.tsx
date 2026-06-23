import { useState, type ReactNode } from "react";
import { api } from "../api";
import { summarizeCoachTool } from "./coach-tool-present";
import { buildIdeOpenUrl, inferPathKind, openIdeFileUrl } from "./open-in-ide";
import { ChatMarkdown } from "./chat-markdown";

/** 仅匹配可在 IDE 打开的绝对裸路径；勿匹配相对路径或 JSON 片段 */
const CHAT_PATH_SPLIT_RE =
  /([A-Za-z]:\\[^\s\n\r`「」]+|~\/[^\s\n\r`「」]+|\/(?:[\w@.$~+-]+\/)+[\w@.$~+-]+)/g;

/** 工头 XML 工具块：拆成正文 + 可折叠工具输出（避免路径芯片拆碎 JSON） */
const COACH_TOOL_TAG_RE =
  /<propose_(work_order|clarification)>\s*([\s\S]*?)(?:<\/propose_\1>|$)/gi;

type MessageBlock = { kind: "text"; text: string } | { kind: "path"; path: string };

function splitMessageBlocks(text: string): MessageBlock[] {
  const rawParts = text.split(CHAT_PATH_SPLIT_RE).filter((part) => part.length > 0);
  const blocks: MessageBlock[] = [];

  for (let i = 0; i < rawParts.length; i++) {
    const part = rawParts[i]!;
    if (isChatPathSegment(part)) {
      blocks.push({ kind: "path", path: part });
      continue;
    }

    const cleaned = cleanTextAroundPath(
      part,
      i > 0 && isChatPathSegment(rawParts[i - 1]!),
      i < rawParts.length - 1 && isChatPathSegment(rawParts[i + 1]!),
    );
    if (!cleaned) continue;

    const last = blocks[blocks.length - 1];
    if (last?.kind === "text") {
      last.text += cleaned;
    } else {
      blocks.push({ kind: "text", text: cleaned });
    }
  }

  return blocks;
}

function stripPathWrapper(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function isChatPathSegment(part: string): boolean {
  const path = stripPathWrapper(part);
  return (
    /^[A-Za-z]:\\/.test(path) ||
    /^~\//.test(path) ||
    /^\/(?:[\w@.$~+-]+\/)+[\w@.$~+-]+$/.test(path)
  );
}

export type CoachMessagePart =
  | { kind: "text"; text: string }
  | { kind: "tool"; toolName: string; payload: string; incomplete: boolean };

export function splitCoachMessageParts(text: string): CoachMessagePart[] {
  const parts: CoachMessagePart[] = [];
  let lastIndex = 0;
  const re = new RegExp(COACH_TOOL_TAG_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index).replace(/\n{3,}/g, "\n\n");
    if (before.trim()) {
      parts.push({ kind: "text", text: before.trimEnd() });
    }
    const tag = match[1]!;
    const full = match[0]!;
    parts.push({
      kind: "tool",
      toolName: `propose_${tag}`,
      payload: match[2]!.trim(),
      incomplete: !full.includes(`</propose_${tag}>`),
    });
    lastIndex = match.index + full.length;
  }
  const tail = text.slice(lastIndex).replace(/\n{3,}/g, "\n\n");
  if (tail.trim()) {
    parts.push({ kind: "text", text: tail.trimEnd() });
  }
  if (parts.length === 0) {
    parts.push({ kind: "text", text });
  }
  return parts;
}

function formatCoachToolPayload(raw: string): string {
  const jsonStart = raw.indexOf("{");
  if (jsonStart === -1) return raw;
  try {
    return JSON.stringify(JSON.parse(raw.slice(jsonStart)), null, 2);
  } catch {
    return raw.slice(jsonStart);
  }
}

function coachToolLabel(toolName: string): string {
  if (toolName === "propose_work_order") return "整理任务单";
  if (toolName === "propose_clarification") return "发起澄清";
  return toolName;
}

export function ChatCoachToolBlock({
  toolName,
  payload,
  streaming,
}: {
  toolName: string;
  payload: string;
  streaming?: boolean;
}) {
  const label = coachToolLabel(toolName);
  const formatted = formatCoachToolPayload(payload);
  const summary = summarizeCoachTool(toolName, payload, streaming);
  return (
    <details className="chat-coach-tool-block" open={streaming || undefined}>
      <summary className="chat-coach-tool-summary">
        <span className="chat-coach-tool-badge" aria-hidden>
          fn
        </span>
        {streaming ? `${label}…` : `工头调用 · ${label}`}
        {!streaming && summary.headline && (
          <span className="chat-coach-tool-headline">{summary.headline}</span>
        )}
      </summary>
      {summary.details.length > 0 && (
        <ul className="chat-coach-tool-details">
          {summary.details.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <pre className="chat-coach-tool-payload">{formatted || "…"}</pre>
    </details>
  );
}

/** @deprecated 保留兼容；展示请用 splitCoachMessageParts / renderCoachMessageText */
export function prepareCoachMessageDisplay(text: string): string {
  return splitCoachMessageParts(text)
    .filter((p): p is Extract<CoachMessagePart, { kind: "text" }> => p.kind === "text")
    .map((p) => p.text)
    .join("\n\n")
    .trimEnd();
}

function shouldDisablePathChips(text: string, options?: ChatRenderOptions): boolean {
  if (options?.streaming) return true;
  if (/<propose_(?:work_order|clarification)>/i.test(text)) return true;
  if (/"executionPrompt"\s*:/.test(text) && /"action"\s*:/.test(text)) return true;
  return false;
}

function pathBasename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function isDirectoryPath(path: string): boolean {
  if (/[\\/]$/.test(path)) return true;
  const base = pathBasename(path);
  return !base.includes(".") || base === "." || base === "..";
}

function FilePathIcon({ directory }: { directory?: boolean }) {
  if (directory) {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M2.5 4.5A1 1 0 0 1 3.5 3.5H6.2L7.4 5h5.1a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V4.5Z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4.5 2.5h4.1L11.5 5.5v8a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M8.2 2.5V5.5H11.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function ChatFilePathChip({
  path,
  onUserBubble,
}: {
  path: string;
  onUserBubble?: boolean;
}) {
  const [opening, setOpening] = useState(false);
  const normalized = stripPathWrapper(path);
  const directory = isDirectoryPath(normalized);
  const base = pathBasename(normalized);
  const hasDirPrefix = normalized.endsWith(base) && normalized.length > base.length;

  const openInIde = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const res = await api.openInIde(normalized);
      if (!res.ok && res.kind !== "directory") {
        const kind = res.kind ?? inferPathKind(res.absolutePath || normalized);
        const url =
          res.ideUrl ?? buildIdeOpenUrl(res.absolutePath || normalized, kind);
        if (url) openIdeFileUrl(url);
      }
    } catch {
      if (!directory) {
        const url = buildIdeOpenUrl(normalized, "file");
        if (url) openIdeFileUrl(url);
      }
    } finally {
      window.setTimeout(() => setOpening(false), 600);
    }
  };

  return (
    <button
      type="button"
      className={`chat-file-path${onUserBubble ? " on-user" : ""}${opening ? " opening" : ""}`}
      title={`${normalized}\n点击${directory ? "打开文件夹" : "在 IDE 中打开文件"}`}
      aria-label={directory ? `打开文件夹 ${normalized}` : `在 IDE 中打开文件 ${normalized}`}
      onClick={() => void openInIde()}
    >
      <span className="chat-file-path-icon">
        <FilePathIcon directory={directory} />
      </span>
      <span className="chat-file-path-text">
        {hasDirPrefix ? (
          <>
            <span className="chat-file-path-dir">{normalized.slice(0, -base.length)}</span>
            <span className="chat-file-path-base">{base}</span>
          </>
        ) : (
          normalized
        )}
      </span>
      <span className="chat-file-path-action" aria-hidden>
        {opening ? "…" : "↗"}
      </span>
    </button>
  );
}

/** 去掉路径芯片两侧多余空行，避免 pre-wrap 渲染出「中间空一行」 */
function cleanTextAroundPath(
  part: string,
  prevIsPath: boolean,
  nextIsPath: boolean,
): string {
  let t = part;
  if (prevIsPath) {
    t = t.replace(/^\n+/, "");
  }
  if (nextIsPath) {
    t = t.replace(/\n+$/, "");
  }
  return t;
}

export type ChatRenderOptions = {
  /** 流式输出中：纯文本，完成后走 Markdown/HTML */
  streaming?: boolean;
};

export function renderCoachMessageText(
  text: string,
  options?: ChatRenderOptions,
): ReactNode {
  const parts = splitCoachMessageParts(text);
  if (parts.length === 1 && parts[0]!.kind === "text") {
    return renderChatMessageText(parts[0]!.text, false, options);
  }
  return (
    <div className="chat-coach-message">
      {parts.map((part, index) =>
        part.kind === "tool" ? (
          <ChatCoachToolBlock
            key={`tool-${index}`}
            toolName={part.toolName}
            payload={part.payload}
            streaming={options?.streaming === true && part.incomplete}
          />
        ) : (
          <div key={`text-${index}`}>
            {renderChatMessageText(part.text, false, options)}
          </div>
        ),
      )}
    </div>
  );
}

export function renderChatMessageText(
  text: string,
  onUserBubble = false,
  options?: ChatRenderOptions,
): ReactNode {
  const plain = options?.streaming === true;
  if (shouldDisablePathChips(text, options)) {
    return <ChatMarkdown text={text} plain={plain} />;
  }
  const blocks = splitMessageBlocks(text);
  if (blocks.length === 1 && blocks[0]!.kind === "text") {
    return <ChatMarkdown text={blocks[0]!.text} plain={plain} />;
  }

  return (
    <div className="chat-message-mixed">
      {blocks.map((block, index) =>
        block.kind === "path" ? (
          <ChatFilePathChip key={`path-${index}`} path={block.path} onUserBubble={onUserBubble} />
        ) : (
          <ChatMarkdown
            key={`text-${index}`}
            className={
              index > 0 && blocks[index - 1]!.kind === "path" ? "after-path" : undefined
            }
            text={block.text}
            plain={plain}
          />
        ),
      )}
    </div>
  );
}
