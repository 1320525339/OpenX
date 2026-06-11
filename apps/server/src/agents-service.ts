import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  COACH_AGENT_ROLES,
  parseAgentFrontmatter,
  stripAgentFrontmatter,
  type AgentCatalogEntry,
} from "@openx/shared";
import { getOpenxAgentsDir } from "@openx/shared/agents-path";

const AGENT_MD = "AGENT.md";
const FRONTMATTER_READ_BYTES = 2048;

type CatalogCache = {
  signature: string;
  entries: AgentCatalogEntry[];
};

let catalogCache: CatalogCache | null = null;
let builtinsEnsured = false;

function formatAgentMd(role: { name: string; desc: string; rolePrompt: string }): string {
  return `---\nname: ${role.name}\ndescription: ${role.desc}\n---\n\n${role.rolePrompt}\n`;
}

function migrateLegacyCoachAgentDirs(root: string): void {
  const legacyPi = join(root, "pi");
  const coderDir = join(root, "coder");
  if (existsSync(legacyPi) && !existsSync(coderDir)) {
    try {
      renameSync(legacyPi, coderDir);
      catalogCache = null;
    } catch {
      /* 忽略迁移失败，保留旧目录 */
    }
  }
}

/** 确保内置 Agent 种子 AGENT.md 存在（启动时或目录缺失时调用一次） */
export function ensureBuiltinAgents(): void {
  const root = getOpenxAgentsDir();
  mkdirSync(root, { recursive: true });
  migrateLegacyCoachAgentDirs(root);
  for (const [id, role] of Object.entries(COACH_AGENT_ROLES)) {
    const mdPath = join(getOpenxAgentsDir(), id, AGENT_MD);
    if (existsSync(mdPath)) continue;
    mkdirSync(join(getOpenxAgentsDir(), id), { recursive: true });
    writeFileSync(mdPath, formatAgentMd(role), "utf8");
  }
  builtinsEnsured = true;
  catalogCache = null;
}

function ensureAgentsDirReady(): void {
  const root = getOpenxAgentsDir();
  if (!builtinsEnsured || !existsSync(root)) {
    ensureBuiltinAgents();
  }
}

function readFrontmatterSlice(mdPath: string): string {
  const fd = readFileSync(mdPath);
  return fd.subarray(0, Math.min(fd.length, FRONTMATTER_READ_BYTES)).toString("utf8");
}

function computeCatalogSignature(root: string): string {
  if (!existsSync(root)) return "missing";
  let signature = String(statSync(root).mtimeMs);
  for (const name of readdirSync(root)) {
    if (name.startsWith(".")) continue;
    const mdPath = join(root, name, AGENT_MD);
    if (!existsSync(mdPath)) continue;
    try {
      signature += `|${name}:${statSync(mdPath).mtimeMs}`;
    } catch {
      signature += `|${name}:err`;
    }
  }
  return signature;
}

function scanAgentCatalog(root: string): AgentCatalogEntry[] {
  const entries: AgentCatalogEntry[] = [];
  for (const name of readdirSync(root)) {
    if (name.startsWith(".")) continue;
    const agentDir = join(root, name);
    try {
      if (!statSync(agentDir).isDirectory()) continue;
    } catch {
      continue;
    }
    const mdPath = join(agentDir, AGENT_MD);
    if (!existsSync(mdPath)) continue;
    const fm = parseAgentFrontmatter(readFrontmatterSlice(mdPath));
    const fallback = COACH_AGENT_ROLES[name];
    entries.push({
      id: name,
      name: fm.name ?? fallback?.name ?? name,
      desc: fm.description ?? fallback?.desc ?? "",
      agentMdPath: mdPath,
      builtin: Boolean(fallback),
    });
  }

  return entries.sort((a, b) => {
    if (a.builtin && !b.builtin) return -1;
    if (!a.builtin && b.builtin) return 1;
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

/** 扫描 ~/.openx/agents 下各子目录的 AGENT.md（带 mtime 缓存） */
export function listAgentCatalog(): AgentCatalogEntry[] {
  ensureAgentsDirReady();
  const root = getOpenxAgentsDir();
  if (!existsSync(root)) return [];

  const signature = computeCatalogSignature(root);
  if (catalogCache?.signature === signature) {
    return catalogCache.entries;
  }

  const entries = scanAgentCatalog(root);
  catalogCache = { signature, entries };
  return entries;
}

export function invalidateAgentCatalogCache(): void {
  catalogCache = null;
}

export function readAgentMd(agentId: string): {
  name: string;
  desc: string;
  body: string;
} | null {
  ensureAgentsDirReady();
  const mdPath = join(getOpenxAgentsDir(), agentId, AGENT_MD);
  if (!existsSync(mdPath)) return null;
  const content = readFileSync(mdPath, "utf8");
  const fm = parseAgentFrontmatter(content);
  const fallback = COACH_AGENT_ROLES[agentId];
  return {
    name: fm.name ?? fallback?.name ?? agentId,
    desc: fm.description ?? fallback?.desc ?? "",
    body: stripAgentFrontmatter(content),
  };
}

export function writeAgentMd(agentId: string, content: string): void {
  const id = agentId.trim();
  if (!id || id.includes("/") || id.includes("..")) {
    throw new Error("Invalid agent id");
  }
  ensureAgentsDirReady();
  const agentDir = join(getOpenxAgentsDir(), id);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, AGENT_MD), content, "utf8");
  invalidateAgentCatalogCache();
}

export function resolveCoachAgent(agentId?: string): {
  id: string;
  name: string;
  desc: string;
  rolePrompt: string;
} {
  const raw = agentId?.trim() || "coach";
  const id = raw === "pi" ? "coder" : raw;
  const md = readAgentMd(id);
  if (md?.body) {
    return { id, name: md.name, desc: md.desc, rolePrompt: md.body };
  }
  const fallback = COACH_AGENT_ROLES[id];
  if (fallback) {
    return {
      id,
      name: fallback.name,
      desc: fallback.desc,
      rolePrompt: fallback.rolePrompt,
    };
  }
  const catalog = listAgentCatalog();
  const match = catalog.find((a) => a.id === id) ?? catalog[0];
  if (match) {
    const body = readAgentMd(match.id);
    if (body?.body) {
      return {
        id: match.id,
        name: body.name,
        desc: body.desc,
        rolePrompt: body.body,
      };
    }
  }
  const coach = COACH_AGENT_ROLES.coach;
  return {
    id: "coach",
    name: coach.name,
    desc: coach.desc,
    rolePrompt: coach.rolePrompt,
  };
}

export function ensureBuiltinAgentsOnStartup(): void {
  try {
    ensureBuiltinAgents();
  } catch (err) {
    console.warn(
      "[agents] 内置 Agent 种子初始化失败:",
      err instanceof Error ? err.message : err,
    );
  }
}
