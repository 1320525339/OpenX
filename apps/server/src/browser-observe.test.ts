import { describe, expect, it } from "vitest";
import { createNetworkLog } from "./browser-observe.js";

describe("browser-observe", () => {
  it("createNetworkLog caps entries at max", () => {
    const log = createNetworkLog(3);
    for (let i = 0; i < 5; i++) {
      log.push({ id: String(i), url: `https://x/${i}`, method: "GET", ts: i });
    }
    const list = log.list();
    expect(list).toHaveLength(3);
    expect(list[0]?.url).toBe("https://x/2");
    expect(list[2]?.url).toBe("https://x/4");
  });
});
