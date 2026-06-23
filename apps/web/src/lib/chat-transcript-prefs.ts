const HOT_TURNS_KEY = "openx.chat.transcriptHotTurns";
const WARM_PAGE_KEY = "openx.chat.transcriptWarmPageSize";

export const CHAT_TRANSCRIPT_HOT_TURNS_DEFAULT = 20;
export const CHAT_TRANSCRIPT_WARM_PAGE_DEFAULT = 15;
export const CHAT_TRANSCRIPT_HOT_TURNS_MIN = 5;
export const CHAT_TRANSCRIPT_HOT_TURNS_MAX = 60;
export const CHAT_TRANSCRIPT_WARM_PAGE_MIN = 5;
export const CHAT_TRANSCRIPT_WARM_PAGE_MAX = 40;

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readInt(key: string, fallback: number, min: number, max: number): number {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    if (raw == null || raw === "") return fallback;
    return clampInt(Number(raw), min, max, fallback);
  } catch {
    return fallback;
  }
}

function writeInt(key: string, value: number, min: number, max: number): number {
  const next = clampInt(value, min, max, value);
  try {
    localStorage?.setItem(key, String(next));
  } catch {
    /* ignore quota / private mode */
  }
  return next;
}

export function getChatTranscriptHotTurns(): number {
  return readInt(
    HOT_TURNS_KEY,
    CHAT_TRANSCRIPT_HOT_TURNS_DEFAULT,
    CHAT_TRANSCRIPT_HOT_TURNS_MIN,
    CHAT_TRANSCRIPT_HOT_TURNS_MAX,
  );
}

export function setChatTranscriptHotTurns(value: number): number {
  return writeInt(
    HOT_TURNS_KEY,
    value,
    CHAT_TRANSCRIPT_HOT_TURNS_MIN,
    CHAT_TRANSCRIPT_HOT_TURNS_MAX,
  );
}

export function getChatTranscriptWarmPageSize(): number {
  return readInt(
    WARM_PAGE_KEY,
    CHAT_TRANSCRIPT_WARM_PAGE_DEFAULT,
    CHAT_TRANSCRIPT_WARM_PAGE_MIN,
    CHAT_TRANSCRIPT_WARM_PAGE_MAX,
  );
}

export function setChatTranscriptWarmPageSize(value: number): number {
  return writeInt(
    WARM_PAGE_KEY,
    value,
    CHAT_TRANSCRIPT_WARM_PAGE_MIN,
    CHAT_TRANSCRIPT_WARM_PAGE_MAX,
  );
}

export type ChatTranscriptPrefs = {
  hotTurns: number;
  warmPageSize: number;
};

export function readChatTranscriptPrefs(): ChatTranscriptPrefs {
  return {
    hotTurns: getChatTranscriptHotTurns(),
    warmPageSize: getChatTranscriptWarmPageSize(),
  };
}

export function saveChatTranscriptPrefs(partial: Partial<ChatTranscriptPrefs>): ChatTranscriptPrefs {
  const current = readChatTranscriptPrefs();
  const hotTurns =
    partial.hotTurns != null ? setChatTranscriptHotTurns(partial.hotTurns) : current.hotTurns;
  const warmPageSize =
    partial.warmPageSize != null
      ? setChatTranscriptWarmPageSize(partial.warmPageSize)
      : current.warmPageSize;
  return { hotTurns, warmPageSize };
}
