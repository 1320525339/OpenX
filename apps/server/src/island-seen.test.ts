import { beforeEach, describe, expect, it } from "vitest";
import {
  bulkMarkIslandSeen,
  isIslandSeenInDb,
  listIslandSeenIds,
  resetDb,
} from "./db.js";
import { app } from "./routes.js";

const jsonHeaders = { "Content-Type": "application/json" };

describe("island_seen", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
  });

  it("persists seen ids in sqlite", () => {
    expect(bulkMarkIslandSeen(["a", "b"])).toBe(2);
    expect(isIslandSeenInDb("a")).toBe(true);
    expect(listIslandSeenIds()).toEqual(expect.arrayContaining(["a", "b"]));
    expect(bulkMarkIslandSeen(["a", "c"])).toBe(1);
    expect(isIslandSeenInDb("c")).toBe(true);
  });

  it("exposes GET/POST /api/island/seen", async () => {
    const post = await app.request("/api/island/seen", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ ids: ["x-1", "x-2"] }),
    });
    expect(post.status).toBe(200);
    const postBody = (await post.json()) as { ok: boolean; marked: number };
    expect(postBody).toEqual({ ok: true, marked: 2 });

    const get = await app.request("/api/island/seen");
    expect(get.status).toBe(200);
    const getBody = (await get.json()) as { seenIds: string[] };
    expect(getBody.seenIds).toEqual(expect.arrayContaining(["x-1", "x-2"]));
  });
});
