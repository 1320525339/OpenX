import { describe, expect, it } from "vitest";
import {
  deriveDefaultKnowledgeSourceLabel,
} from "./knowledge-source-distill.js";

describe("knowledge-source-distill", () => {
  it("derives label from path basename", () => {
    expect(deriveDefaultKnowledgeSourceLabel("D:\\docs\\react", "path")).toBe("react");
  });

  it("derives label from url hostname", () => {
    expect(
      deriveDefaultKnowledgeSourceLabel("https://react.dev/learn\nhttps://react.dev/reference", "url"),
    ).toBe("react.dev");
  });
});
