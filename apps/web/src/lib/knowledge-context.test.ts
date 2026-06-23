import { describe, expect, it } from "vitest";
import {
  buildKnowledgePickerItems,
  enabledMapToSelection,
  knowledgeSelectionLabel,
  selectionToEnabledMap,
} from "./knowledge-context";

describe("knowledge-context", () => {
  it("defaults to all enabled", () => {
    const items = buildKnowledgePickerItems({
      isSystemMain: false,
      globalSources: [
        {
          id: "g1",
          label: "全局源",
          kind: "path",
          uri: "/x",
          scope: "global",
          status: "ready",
          docCount: 1,
          createdAt: "",
          updatedAt: "",
        },
      ],
      projectSources: [],
    });
    const map = selectionToEnabledMap(items, { mode: "all" });
    expect(Object.values(map).every(Boolean)).toBe(true);
    expect(knowledgeSelectionLabel({ mode: "all" }, items.length, items.length)).toBe("全部");
  });

  it("reuses stable selection object when all enabled", () => {
    const items = buildKnowledgePickerItems({
      isSystemMain: true,
      globalSources: [],
      projectSources: [],
    });
    const enabled = Object.fromEntries(items.map((item) => [item.id, true]));
    expect(enabledMapToSelection(items, enabled)).toBe(enabledMapToSelection(items, enabled));
  });

  it("maps custom selection from enabled map", () => {
    const items = buildKnowledgePickerItems({
      isSystemMain: false,
      globalSources: [],
      projectSources: [
        {
          id: "p1",
          label: "项目源",
          kind: "url",
          uri: "https://a",
          scope: "user",
          projectId: "proj",
          status: "ready",
          docCount: 2,
          createdAt: "",
          updatedAt: "",
        },
      ],
    });
    const enabled = Object.fromEntries(items.map((item) => [item.id, item.id === "p1"]));
    const selection = enabledMapToSelection(items, enabled);
    expect(selection.mode).toBe("custom");
    expect(selection.sourceIds).toContain("p1");
  });
});
