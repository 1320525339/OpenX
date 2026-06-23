import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { app } from "../routes/index.js";
import { resetDb } from "../db.js";
import { listKnowledgeEntries } from "../knowledge-store.js";
import { seedTestProjectAndConversation, TEST_PROJECT_ID } from "../test-helpers.js";
import { shutdownZvecKnowledgeIndex } from "../zvec-knowledge-index.js";

function useIsolatedOpenxDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "openx-knowledge-route-"));
  writeFileSync(join(dir, "config.json"), "{}");
  process.env.OPENX_CONFIG_PATH = join(dir, "config.json");
  process.env.OPENX_DB_PATH = ":memory:";
  return dir;
}

describe("knowledge routes", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = useIsolatedOpenxDir();
    resetDb();
    seedTestProjectAndConversation();
  });

  afterEach(() => {
    resetDb();
    shutdownZvecKnowledgeIndex();
    delete process.env.OPENX_DB_PATH;
    delete process.env.OPENX_CONFIG_PATH;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("CRUD project user knowledge entries", async () => {
    const createRes = await app.request(`/api/projects/${TEST_PROJECT_ID}/knowledge/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "技术栈",
        content: "React 19 + Vite",
        category: "fact",
      }),
    });
    expect(createRes.status).toBe(201);
    const { entry } = (await createRes.json()) as { entry: { id: string } };

    const listRes = await app.request(`/api/projects/${TEST_PROJECT_ID}/knowledge`);
    const listBody = (await listRes.json()) as { entries: Array<{ id: string }> };
    expect(listBody.entries.some((e) => e.id === entry.id)).toBe(true);

    const patchRes = await app.request(
      `/api/projects/${TEST_PROJECT_ID}/knowledge/entries/${entry.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "技术栈（更新）" }),
      },
    );
    expect(patchRes.status).toBe(200);

    const delRes = await app.request(
      `/api/projects/${TEST_PROJECT_ID}/knowledge/entries/${entry.id}`,
      { method: "DELETE" },
    );
    expect(delRes.status).toBe(200);
  });

  it("manages global knowledge entries", async () => {
    const createRes = await app.request("/api/knowledge/global/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "调度 SOP",
        content: "失败任务先查日志",
      }),
    });
    expect(createRes.status).toBe(201);

    const listRes = await app.request("/api/knowledge/global");
    const listBody = (await listRes.json()) as { entries: unknown[] };
    expect(listBody.entries.length).toBe(1);
  });

  it("saves knowledge via coach endpoint", async () => {
    const saveRes = await app.request("/api/knowledge/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: TEST_PROJECT_ID,
        title: "Coach 记忆",
        content: "返工前先跑测试",
      }),
    });
    expect(saveRes.status).toBe(201);
  });

  it("promotes user knowledge to global", async () => {
    const createRes = await app.request(`/api/projects/${TEST_PROJECT_ID}/knowledge/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "复用经验", content: "统一 vitest" }),
    });
    const { entry } = (await createRes.json()) as { entry: { id: string } };

    const promoteRes = await app.request(
      `/api/knowledge/promote?projectId=${encodeURIComponent(TEST_PROJECT_ID)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId: entry.id,
          fromScope: "user",
          toScope: "global",
        }),
      },
    );
    expect(promoteRes.status).toBe(200);
  });

  it("reports index health and rebuilds indexes", async () => {
    await app.request(`/api/projects/${TEST_PROJECT_ID}/knowledge/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "索引重建", content: "Zvec rebuild smoke" }),
    });

    const healthRes = await app.request("/api/knowledge/health");
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as { projects: number; userEntries: number };
    expect(health.projects).toBeGreaterThanOrEqual(1);
    expect(health.userEntries).toBeGreaterThanOrEqual(1);

    const rebuildRes = await app.request(
      `/api/knowledge/rebuild?projectId=${encodeURIComponent(TEST_PROJECT_ID)}`,
      { method: "POST" },
    );
    expect(rebuildRes.status).toBe(200);
    const rebuild = (await rebuildRes.json()) as {
      ok: boolean;
      projects: number;
      userEntries: number;
    };
    expect(rebuild.ok).toBe(true);
    expect(rebuild.projects).toBe(1);
    expect(rebuild.userEntries).toBeGreaterThanOrEqual(1);
  });

  it("exposes knowledge rebuild through CLI routes", async () => {
    await app.request(`/api/projects/${TEST_PROJECT_ID}/knowledge/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "CLI 重建", content: "knowledge cli rebuild" }),
    });

    const healthRes = await app.request("/api/cli/knowledge/health");
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as {
      zvecRoot: string;
      sqliteFallbackReady: boolean;
      projectScopes: Array<{ projectId: string }>;
    };
    expect(health.zvecRoot).toContain("zvec");
    expect(health.sqliteFallbackReady).toBe(true);
    expect(health.projectScopes.some((p) => p.projectId === TEST_PROJECT_ID)).toBe(true);

    const rebuildRes = await app.request(
      `/api/cli/knowledge/rebuild?projectId=${encodeURIComponent(TEST_PROJECT_ID)}`,
      { method: "POST" },
    );
    expect(rebuildRes.status).toBe(200);
    const rebuild = (await rebuildRes.json()) as { ok: boolean; projects: number };
    expect(rebuild.ok).toBe(true);
    expect(rebuild.projects).toBe(1);
  });

  it("removes user knowledge when project deleted", async () => {
    await app.request(`/api/projects/${TEST_PROJECT_ID}/knowledge/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "随项目删除", content: "不应保留" }),
    });
    expect(listKnowledgeEntries("user", TEST_PROJECT_ID)).toHaveLength(1);

    const delProject = await app.request(`/api/projects/${TEST_PROJECT_ID}`, {
      method: "DELETE",
    });
    expect(delProject.status).toBe(200);
    expect(listKnowledgeEntries("user", TEST_PROJECT_ID)).toHaveLength(0);
  });

  it("returns 409 when rebuild already in progress", async () => {
    const { rebuildKnowledgeIndexesAsync } = await import("../knowledge-store.js");
    const inFlight = rebuildKnowledgeIndexesAsync();
    const res = await app.request("/api/knowledge/rebuild", { method: "POST" });
    expect(res.status).toBe(409);
    await inFlight;
  });

  it("manages global knowledge sources", async () => {
    const docsDir = mkdtempSync(join(tmpdir(), "openx-knowledge-route-src-"));
    writeFileSync(join(docsDir, "note.md"), "# 路由测试\n知识源导入");

    const createRes = await app.request("/api/knowledge/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "path",
        label: "路由文档",
        uri: docsDir,
      }),
    });
    expect(createRes.status).toBe(201);
    const { source } = (await createRes.json()) as { source: { id: string; docCount: number } };
    expect(source.docCount).toBeGreaterThanOrEqual(1);

    const listRes = await app.request("/api/knowledge/sources");
    const listBody = (await listRes.json()) as { sources: Array<{ id: string }> };
    expect(listBody.sources.some((s) => s.id === source.id)).toBe(true);

    const delRes = await app.request(`/api/knowledge/sources/${encodeURIComponent(source.id)}`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);
    rmSync(docsDir, { recursive: true, force: true });
  });
});
