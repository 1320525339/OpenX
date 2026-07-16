import { describe, expect, it } from "vitest";
import { parseMilocoCliJson } from "./miloco-cli-runner.js";

describe("miloco-cli-runner", () => {
  it("parses JSON after wsl noise", () => {
    const raw = `wsl: warning...\n{"code":0,"data":[{"did":"1184112433","name":"摄像头","in_use":true,"is_online":false,"connected":false}]}`;
    const parsed = parseMilocoCliJson<{ data: Array<{ did: string }> }>(raw);
    expect(parsed?.data?.[0]?.did).toBe("1184112433");
  });
});
