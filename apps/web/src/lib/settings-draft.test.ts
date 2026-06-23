import { describe, expect, it } from "vitest";
import { SettingsSchema } from "@openx/shared";
import {
  mergeServerSettingsIntoDraft,
  settingsDraftDirty,
} from "./settings-draft";

describe("settingsDraftDirty", () => {
  it("detects operatorTier changes", () => {
    const saved = SettingsSchema.parse({ operatorTier: "off", revision: 1 });
    const draft = { ...saved, operatorTier: "read" as const };
    expect(settingsDraftDirty(saved, draft)).toBe(true);
  });

  it("ignores workspaceResolved-only differences", () => {
    const saved = {
      ...SettingsSchema.parse({ operatorTier: "read", revision: 1 }),
      workspaceResolved: "/a",
      systemWorkspaceResolved: "/b",
    };
    const draft = SettingsSchema.parse({ operatorTier: "read", revision: 1 });
    expect(settingsDraftDirty(saved, draft)).toBe(false);
  });
});

describe("mergeServerSettingsIntoDraft", () => {
  it("keeps unsaved operatorTier when provider settings refresh from server", () => {
    const local = SettingsSchema.parse({ operatorTier: "read", revision: 1 });
    const server = SettingsSchema.parse({ operatorTier: "off", revision: 2 });
    const merged = mergeServerSettingsIntoDraft(local, server);
    expect(merged.operatorTier).toBe("read");
    expect(merged.revision).toBe(2);
  });
});
