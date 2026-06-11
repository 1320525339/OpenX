import { describe, expect, it } from "vitest";
import {
  ACP_RUNTIMES,
  ExecutorIdSchema,
  isAcpExecutorId,
  isConnectExecutorId,
  isValidExecutorId,
  parseAcpRuntimeId,
} from "./executor.js";

describe("ExecutorIdSchema", () => {
  it("accepts pi", () => {
    expect(ExecutorIdSchema.parse("pi")).toBe("pi");
  });

  it("accepts acp runtimes", () => {
    for (const id of Object.keys(ACP_RUNTIMES)) {
      expect(ExecutorIdSchema.parse(id)).toBe(id);
    }
  });

  it("accepts connect executor ids", () => {
    expect(ExecutorIdSchema.parse("cursor-worker")).toBe("cursor-worker");
    expect(ExecutorIdSchema.parse("smoke-worker")).toBe("smoke-worker");
  });

  it("accepts auto", () => {
    expect(ExecutorIdSchema.parse("auto")).toBe("auto");
  });

  it("rejects invalid ids", () => {
    expect(ExecutorIdSchema.safeParse("").success).toBe(false);
    expect(ExecutorIdSchema.safeParse("acp:").success).toBe(false);
    expect(ExecutorIdSchema.safeParse("../evil").success).toBe(false);
  });
});

describe("executor helpers", () => {
  it("classifies acp ids", () => {
    expect(isAcpExecutorId("acp:gemini")).toBe(true);
    expect(isAcpExecutorId("pi")).toBe(false);
    expect(parseAcpRuntimeId("acp:gemini")).toBe("acp:gemini");
    expect(parseAcpRuntimeId("acp:unknown")).toBeNull();
  });

  it("classifies connect ids", () => {
    expect(isConnectExecutorId("cursor-worker")).toBe(true);
    expect(isConnectExecutorId("connect:any")).toBe(true);
    expect(isConnectExecutorId("pi")).toBe(false);
    expect(isConnectExecutorId("acp:gemini")).toBe(false);
  });

  it("validates via isValidExecutorId", () => {
    expect(isValidExecutorId("pi")).toBe(true);
    expect(isValidExecutorId("acp:gemini")).toBe(true);
    expect(isValidExecutorId("bad id")).toBe(false);
  });
});
