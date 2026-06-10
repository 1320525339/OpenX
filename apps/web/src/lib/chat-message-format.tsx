import { useState, type ReactNode } from "react";
import { api } from "../api";
import { buildIdeOpenUrl, inferPathKind, openIdeFileUrl } from "./open-in-ide";
import { ChatMarkdown } from "./chat-markdown";

/** 仅匹配裸路径；勿匹配 `` `inline code` ``，否则会拆碎 Markdown 行内代码 */
const CHAT_PATH_SPLIT_RE =
  /([A-Za-z]:\\[^\s\n\r`「」]+|~\/[^\s\n\r`「」]+|\/(?:[\w@.$~+-]+\/)+[\w@.$~+-]+|(?:[\w@.$~+-]+[/\\])+[\w@.$~+-]+)/g;

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
    /^\/(?:[\w@.$~+-]+\/)+[\w@.$~+-]+$/.test(path) ||
    /^(?:[\w@.$~+-]+[/\\])+[\w@.$~+-]+$/.test(path)
  );
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

export function renderChatMessageText(text: string, onUserBubble = false): ReactNode {
  const blocks = splitMessageBlocks(text);
  if (blocks.length === 1 && blocks[0]!.kind === "text") {
    return <ChatMarkdown text={blocks[0]!.text} />;
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
          />
        ),
      )}
    </div>
  );
}
