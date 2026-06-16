import { describe, expect, it } from "vitest";
import { DOCK_FLEX_PRESETS, getFlexPreset, WIDGET_LABELS } from "./flexible-desktop.js";

describe("flexible-desktop presets", () => {
  it("maps chat dock to chat + review", () => {
    const preset = getFlexPreset("chat");
    expect(preset.primary).toBe("chat");
    expect(preset.secondary).toBe("review");
    expect(preset.defaultSecondaryPinned).toBe(true);
  });

  it("maps artifacts dock to artifacts + chat (施工桌面)", () => {
    const preset = getFlexPreset("artifacts");
    expect(preset.primary).toBe("artifacts");
    expect(preset.secondary).toBe("chat");
    expect(preset.defaultSecondaryPinned).toBe(true);
  });

  it("maps tasks dock to full-width tasks", () => {
    const preset = getFlexPreset("tasks");
    expect(preset.primary).toBe("tasks");
    expect(preset.secondary).toBeUndefined();
  });

  it("labels all widget ids", () => {
    for (const key of Object.keys(DOCK_FLEX_PRESETS)) {
      const preset = DOCK_FLEX_PRESETS[key as keyof typeof DOCK_FLEX_PRESETS];
      expect(WIDGET_LABELS[preset.primary]).toBeTruthy();
      if (preset.secondary) expect(WIDGET_LABELS[preset.secondary]).toBeTruthy();
    }
  });
});
