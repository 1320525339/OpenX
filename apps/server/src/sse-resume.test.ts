import { describe, expect, it } from "vitest";
import { parseSseLastEventId } from "./sse-resume.js";

describe("parseSseLastEventId", () => {
  it("空值视为首次连接", () => {
    expect(parseSseLastEventId(undefined)).toBeUndefined();
    expect(parseSseLastEventId("")).toBeUndefined();
    expect(parseSseLastEventId("  ")).toBeUndefined();
  });

  it("历史 connected 游标 0 视为首次连接", () => {
    expect(parseSseLastEventId("0")).toBeUndefined();
  });

  it("非法值视为首次连接", () => {
    expect(parseSseLastEventId("abc")).toBeUndefined();
    expect(parseSseLastEventId("-1")).toBeUndefined();
  });

  it("正整数返回 resume 游标", () => {
    expect(parseSseLastEventId("1")).toBe(1);
    expect(parseSseLastEventId("42")).toBe(42);
  });
});
