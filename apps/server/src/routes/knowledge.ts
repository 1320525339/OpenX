import { Hono } from "hono";
import {
  CreateKnowledgeEntrySchema,
  CreateKnowledgeSourceSchema,
  PromoteKnowledgeSchema,
  SaveKnowledgeSchema,
  UpdateKnowledgeEntrySchema,
  UpdateKnowledgeSourceSchema,
} from "@openx/shared";
import {
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  getKnowledgeIndexHealth,
  KnowledgeRebuildInProgressError,
  listKnowledgeEntries,
  listRuntimeMemorySections,
  loadKnowledgeContextForCoachAsync,
  mergeKnowledgeSearchHits,
  promoteRuntimeSectionToUser,
  promoteUserEntryToGlobal,
  readRuntimeMemory,
  rebuildKnowledgeIndexesAsync,
  searchScopedKnowledgeAsync,
  updateKnowledgeEntry,
} from "../knowledge-store.js";
import {
  createKnowledgeSource,
  deleteKnowledgeSource,
  KnowledgeImportGuardError,
  listKnowledgeSources,
  reindexKnowledgeSource,
  updateKnowledgeSourceMeta,
} from "../knowledge-sources.js";
import { getProjectById } from "../db.js";
import { resolveWorkspaceRoot } from "../workspace-path.js";

export const knowledgeRoutes = new Hono();

knowledgeRoutes.get("/global", (c) => {
  const entries = listKnowledgeEntries("global");
  return c.json({ scope: "global", entries });
});

knowledgeRoutes.post("/global/entries", async (c) => {
  const input = CreateKnowledgeEntrySchema.parse(await c.req.json());
  const entry = createKnowledgeEntry("global", input);
  return c.json({ entry }, 201);
});

knowledgeRoutes.patch("/global/entries/:entryId", async (c) => {
  const patch = UpdateKnowledgeEntrySchema.parse(await c.req.json());
  const entry = updateKnowledgeEntry("global", c.req.param("entryId"), patch);
  if (!entry) return c.json({ error: "Not found" }, 404);
  return c.json({ entry });
});

knowledgeRoutes.delete("/global/entries/:entryId", (c) => {
  const ok = deleteKnowledgeEntry("global", c.req.param("entryId"));
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

knowledgeRoutes.get("/search", async (c) => {
  const q = c.req.query("q")?.trim() ?? "";
  const projectId = c.req.query("projectId")?.trim();
  const scopesRaw = c.req.query("scopes")?.trim() ?? "user,runtime,global";
  const scopes = scopesRaw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!q) return c.json({ hits: [] });

  const hits = mergeKnowledgeSearchHits(
    (
      await Promise.all(
        scopes.map(async (scope) => {
          if (scope === "global") {
            return (await searchScopedKnowledgeAsync("global", q, { limit: 5 })).map((hit) => ({
              ...hit,
              scope: "global" as const,
            }));
          }
          if (!projectId) return [];
          if (scope === "user") {
            return (await searchScopedKnowledgeAsync("user", q, { projectId, limit: 5 })).map(
              (hit) => ({
                ...hit,
                scope: "user" as const,
              }),
            );
          }
          if (scope === "runtime") {
            return (await searchScopedKnowledgeAsync("runtime", q, { projectId, limit: 5 })).map(
              (hit) => ({
                ...hit,
                scope: "runtime" as const,
              }),
            );
          }
          return [];
        }),
      )
    ).flat(),
  );

  return c.json({ query: q, projectId, hits });
});

knowledgeRoutes.get("/health", (c) => {
  return c.json(getKnowledgeIndexHealth());
});

knowledgeRoutes.get("/sources", (c) => {
  return c.json({ scope: "global", sources: listKnowledgeSources("global") });
});

knowledgeRoutes.post("/sources", async (c) => {
  const input = CreateKnowledgeSourceSchema.parse(await c.req.json());
  try {
    const source = await createKnowledgeSource("global", input);
    return c.json({ source }, 201);
  } catch (err) {
    if (err instanceof KnowledgeImportGuardError) {
      return c.json({ error: err.message }, 400);
    }
    throw err;
  }
});

knowledgeRoutes.patch("/sources/:sourceId", async (c) => {
  const patch = UpdateKnowledgeSourceSchema.parse(await c.req.json());
  try {
    const source = await updateKnowledgeSourceMeta("global", c.req.param("sourceId"), patch);
    if (!source) return c.json({ error: "Not found" }, 404);
    return c.json({ source });
  } catch (err) {
    if (err instanceof KnowledgeImportGuardError) {
      return c.json({ error: err.message }, 400);
    }
    throw err;
  }
});

knowledgeRoutes.post("/sources/:sourceId/reindex", async (c) => {
  const source = await reindexKnowledgeSource("global", c.req.param("sourceId"));
  if (!source) return c.json({ error: "Not found" }, 404);
  return c.json({ source });
});

knowledgeRoutes.delete("/sources/:sourceId", (c) => {
  const ok = deleteKnowledgeSource("global", c.req.param("sourceId"));
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

knowledgeRoutes.post("/rebuild", async (c) => {
  const projectId = c.req.query("projectId")?.trim();
  const embedRaw = c.req.query("embed")?.trim().toLowerCase();
  const includeEmbeddings = embedRaw === "1" || embedRaw === "true" || embedRaw === "yes";
  if (projectId && !getProjectById(projectId)) {
    return c.json({ error: "项目不存在" }, 404);
  }
  try {
    const summary = await rebuildKnowledgeIndexesAsync({
      projectIds: projectId ? [projectId] : undefined,
      includeEmbeddings,
    });
    return c.json({ ok: true, ...summary });
  } catch (err) {
    if (err instanceof KnowledgeRebuildInProgressError) {
      return c.json({ error: "索引重建正在进行中", rebuildInProgress: true }, 409);
    }
    throw err;
  }
});

knowledgeRoutes.post("/promote", async (c) => {
  const input = PromoteKnowledgeSchema.parse(await c.req.json());
  const projectId = c.req.query("projectId")?.trim();
  if (input.fromScope === "user" && input.toScope === "global") {
    if (!projectId) return c.json({ error: "projectId required" }, 400);
    const entry = promoteUserEntryToGlobal(projectId, input.entryId);
    if (!entry) return c.json({ error: "Not found" }, 404);
    return c.json({ entry, detail: "已提升到全局知识" });
  }
  if (input.fromScope === "runtime" && input.toScope === "user") {
    if (!projectId) return c.json({ error: "projectId required" }, 400);
    const project = getProjectById(projectId);
    if (!project) return c.json({ error: "项目不存在" }, 404);
    const workspaceRoot = resolveWorkspaceRoot(project.workspaceDir);
    const heading = input.runtimeHeading?.trim() || input.entryId;
    const entry = promoteRuntimeSectionToUser(workspaceRoot, projectId, heading);
    if (!entry) return c.json({ error: "运行知识章节不存在" }, 404);
    return c.json({ entry, detail: "已提升到项目用户知识" });
  }
  return c.json({ error: "Unsupported promote path" }, 400);
});

/** Coach 工具：保存项目用户知识 */
knowledgeRoutes.post("/save", async (c) => {
  const input = SaveKnowledgeSchema.parse(await c.req.json());
  const project = getProjectById(input.projectId);
  if (!project) return c.json({ error: "项目不存在" }, 404);
  const entry = createKnowledgeEntry(
    "user",
    {
      title: input.title,
      content: input.content,
      category: input.category,
      tags: input.tags,
      source: "coach",
    },
    input.projectId,
  );
  return c.json({ entry, detail: "已保存到项目用户知识" }, 201);
});

export function registerProjectKnowledgeRoutes(projectsRoutes: Hono): void {
  projectsRoutes.get("/:id/knowledge", (c) => {
    const project = getProjectById(c.req.param("id"));
    if (!project) return c.json({ error: "Not found" }, 404);
    const entries = listKnowledgeEntries("user", project.id);
    const workspaceRoot = resolveWorkspaceRoot(project.workspaceDir);
    const runtime = readRuntimeMemory(workspaceRoot, project.id) ?? "";
    const runtimeSections = listRuntimeMemorySections(workspaceRoot, project.id);
    return c.json({
      projectId: project.id,
      entries,
      sources: listKnowledgeSources("user", project.id),
      runtime: { memory: runtime, sections: runtimeSections },
    });
  });

  projectsRoutes.get("/:id/knowledge/sources", (c) => {
    const project = getProjectById(c.req.param("id"));
    if (!project) return c.json({ error: "Not found" }, 404);
    return c.json({
      projectId: project.id,
      sources: listKnowledgeSources("user", project.id),
    });
  });

  projectsRoutes.post("/:id/knowledge/sources", async (c) => {
    const project = getProjectById(c.req.param("id"));
    if (!project) return c.json({ error: "Not found" }, 404);
    const input = CreateKnowledgeSourceSchema.parse(await c.req.json());
    const workspaceRoot = resolveWorkspaceRoot(project.workspaceDir);
    try {
      const source = await createKnowledgeSource("user", input, project.id, {
        workspaceRoot,
      });
      return c.json({ source }, 201);
    } catch (err) {
      if (err instanceof KnowledgeImportGuardError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });

  projectsRoutes.patch("/:id/knowledge/sources/:sourceId", async (c) => {
    const project = getProjectById(c.req.param("id"));
    if (!project) return c.json({ error: "Not found" }, 404);
    const patch = UpdateKnowledgeSourceSchema.parse(await c.req.json());
    const workspaceRoot = resolveWorkspaceRoot(project.workspaceDir);
    try {
      const source = await updateKnowledgeSourceMeta(
        "user",
        c.req.param("sourceId"),
        patch,
        project.id,
        { workspaceRoot },
      );
      if (!source) return c.json({ error: "Not found" }, 404);
      return c.json({ source });
    } catch (err) {
      if (err instanceof KnowledgeImportGuardError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });

  projectsRoutes.post("/:id/knowledge/sources/:sourceId/reindex", async (c) => {
    const project = getProjectById(c.req.param("id"));
    if (!project) return c.json({ error: "Not found" }, 404);
    const workspaceRoot = resolveWorkspaceRoot(project.workspaceDir);
    const source = await reindexKnowledgeSource(
      "user",
      c.req.param("sourceId"),
      project.id,
      { workspaceRoot },
    );
    if (!source) return c.json({ error: "Not found" }, 404);
    return c.json({ source });
  });

  projectsRoutes.delete("/:id/knowledge/sources/:sourceId", (c) => {
    const project = getProjectById(c.req.param("id"));
    if (!project) return c.json({ error: "Not found" }, 404);
    const ok = deleteKnowledgeSource("user", c.req.param("sourceId"), project.id);
    if (!ok) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  });

  projectsRoutes.post("/:id/knowledge/entries", async (c) => {
    const project = getProjectById(c.req.param("id"));
    if (!project) return c.json({ error: "Not found" }, 404);
    const input = CreateKnowledgeEntrySchema.parse(await c.req.json());
    const entry = createKnowledgeEntry("user", input, project.id);
    return c.json({ entry }, 201);
  });

  projectsRoutes.patch("/:id/knowledge/entries/:entryId", async (c) => {
    const project = getProjectById(c.req.param("id"));
    if (!project) return c.json({ error: "Not found" }, 404);
    const patch = UpdateKnowledgeEntrySchema.parse(await c.req.json());
    const entry = updateKnowledgeEntry("user", c.req.param("entryId"), patch, project.id);
    if (!entry) return c.json({ error: "Not found" }, 404);
    return c.json({ entry });
  });

  projectsRoutes.delete("/:id/knowledge/entries/:entryId", (c) => {
    const project = getProjectById(c.req.param("id"));
    if (!project) return c.json({ error: "Not found" }, 404);
    const ok = deleteKnowledgeEntry("user", c.req.param("entryId"), project.id);
    if (!ok) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  });

  projectsRoutes.get("/:id/knowledge/context-preview", async (c) => {
    const project = getProjectById(c.req.param("id"));
    if (!project) return c.json({ error: "Not found" }, 404);
    const workspaceRoot = resolveWorkspaceRoot(project.workspaceDir);
    const q = c.req.query("q")?.trim();
    const context = await loadKnowledgeContextForCoachAsync({
      isSystemMain: false,
      projectId: project.id,
      workspaceRoot,
      query: q,
    });
    return c.json({ projectId: project.id, context: context ?? "" });
  });
}
