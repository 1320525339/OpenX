import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  CHAT_TRANSCRIPT_HOT_TURNS_DEFAULT,
  getChatTranscriptHotTurns,
  readChatTranscriptPrefs,
  saveChatTranscriptPrefs,
  setChatTranscriptHotTurns,
} from "./chat-transcript-prefs";

describe("chat-transcript-prefs", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      store: {} as Record<string, string>,
      getItem(key: string) {
        return this.store[key] ?? null;
      },
      setItem(key: string, value: string) {
        this.store[key] = value;
      },
      removeItem(key: string) {
        delete this.store[key];
      },
      clear() {
        this.store = {};
      },
    });
    localStorage.clear();
  });

  it("returns defaults when unset", () => {
    expect(getChatTranscriptHotTurns()).toBe(CHAT_TRANSCRIPT_HOT_TURNS_DEFAULT);
  });

  it("clamps hot turns into allowed range", () => {
    expect(setChatTranscriptHotTurns(3)).toBe(5);
    expect(setChatTranscriptHotTurns(999)).toBe(60);
    expect(getChatTranscriptHotTurns()).toBe(60);
  });

  it("round-trips via saveChatTranscriptPrefs", () => {
    const saved = saveChatTranscriptPrefs({ hotTurns: 25, warmPageSize: 10 });
    expect(saved).toEqual({ hotTurns: 25, warmPageSize: 10 });
    expect(readChatTranscriptPrefs()).toEqual(saved);
  });
});
