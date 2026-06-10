import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  BUILTIN_GITHUB_SKILLS,
  OBSCURA_SKILL_REPO,
  defaultSkillCatalog,
  githubSkillRemotePath,
  obscuraSkillRepoSlug,
  parseSkillFrontmatter,
  type InstalledSkillRecord,
  type SkillCatalogEntry,
  type SkillManifest,
} from "@openx/shared";
import { getOpenxSkillsDir } from "@openx/shared/skills-path";
import { OPENX_DIR } from "./paths.js";
import { loadSettings } from "./settings-store.js";
import { ensureWorkspaceSkillsLink } from "./workspace-skills-link.js";

function manifestPath(): string {
  return join(getOpenxSkillsDir(), "manifest.json");
}
const GITHUB_API = "https://api.github.com";
const GITHUB_RAW = "https://raw.githubusercontent.com";

type GithubContentEntry = {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  download_url: string | null;
};

let syncPromise: Promise<SkillManifest> | null = null;

function githubHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "openx-skills-sync",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function githubFetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200) || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  mkdirSync(dirname(destPath), { recursive: true });
  const res = await fetch(url, { headers: { "User-Agent": "openx-skills-sync" } });
  if (!res.ok || !res.body) {
    throw new Error(`下载失败 ${url}: ${res.status}`);
  }
  await pipeline(res.body, createWriteStream(destPath));
}

async function listGithubDir(repoPath: string, dirPath: string, ref: string): Promise<GithubContentEntry[]> {
  const url = `${GITHUB_API}/repos/${repoPath}/contents/${dirPath}?ref=${encodeURIComponent(ref)}`;
  const data = await githubFetchJson<GithubContentEntry | GithubContentEntry[]>(url);
  return Array.isArray(data) ? data : [data];
}

async function syncGithubDirectory(
  repoPath: string,
  remoteDir: string,
  localDir: string,
  ref: string,
): Promise<void> {
  const entries = await listGithubDir(repoPath, remoteDir, ref);
  for (const entry of entries) {
    const localPath = join(localDir, entry.name);
    if (entry.type === "dir") {
      await syncGithubDirectory(repoPath, entry.path, localPath, ref);
      continue;
    }
    if (entry.type !== "file") continue;

    const rawUrl =
      entry.download_url ??
      `${GITHUB_RAW}/${repoPath}/${ref}/${entry.path}`;
    await downloadFile(rawUrl, localPath);
  }
}

function emptyManifest(): SkillManifest {
  return { version: 1, skills: {} };
}

export function loadSkillManifest(): SkillManifest {
  try {
    const path = manifestPath();
    if (!existsSync(path)) return emptyManifest();
    const raw = JSON.parse(readFileSync(path, "utf8")) as SkillManifest;
    return raw?.version === 1 && raw.skills ? raw : emptyManifest();
  } catch {
    return emptyManifest();
  }
}

function saveSkillManifest(manifest: SkillManifest): void {
  mkdirSync(getOpenxSkillsDir(), { recursive: true });
  writeFileSync(manifestPath(), JSON.stringify(manifest, null, 2), "utf8");
}

function readInstalledSkillMeta(skillDir: string): Pick<InstalledSkillRecord, "name" | "description"> {
  const skillMd = join(skillDir, "SKILL.md");
  if (!existsSync(skillMd)) return {};
  try {
    return parseSkillFrontmatter(readFileSync(skillMd, "utf8"));
  } catch {
    return {};
  }
}

async function installGithubSkill(
  manifest: SkillManifest,
  skillId: string,
  remotePath: string,
): Promise<void> {
  const repoPath = obscuraSkillRepoSlug();
  const branch = OBSCURA_SKILL_REPO.branch;
  const destDir = join(getOpenxSkillsDir(), skillId);
  const tmpDir = `${destDir}.tmp-${Date.now()}`;

  mkdirSync(getOpenxSkillsDir(), { recursive: true });
  mkdirSync(tmpDir, { recursive: true });

  try {
    await syncGithubDirectory(repoPath, remotePath, tmpDir, branch);
    if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
    mkdirSync(dirname(destDir), { recursive: true });
    // rename on Windows may fail cross-device; copy via readdir
    moveDir(tmpDir, destDir);

    const meta = readInstalledSkillMeta(destDir);
    manifest.skills[skillId] = {
      id: skillId,
      dir: skillId,
      repo: repoPath,
      branch,
      installedAt: new Date().toISOString(),
      skillMdPath: join(destDir, "SKILL.md"),
      name: meta.name,
      description: meta.description,
    };
  } catch (err) {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    const message = err instanceof Error ? err.message : String(err);
    manifest.skills[skillId] = {
      id: skillId,
      dir: skillId,
      repo: repoPath,
      branch,
      installedAt: new Date().toISOString(),
      skillMdPath: join(destDir, "SKILL.md"),
      error: message,
    };
  }
}

function cleanupSkillTempDirs(): void {
  const root = getOpenxSkillsDir();
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    if (name.includes(".tmp-")) {
      rmSync(join(root, name), { recursive: true, force: true });
    }
  }
}

function moveDir(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) {
      const src = join(from, name);
      const dest = join(to, name);
      if (statSync(src).isDirectory()) moveDir(src, dest);
      else {
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, readFileSync(src));
      }
    }
    rmSync(from, { recursive: true, force: true });
  }
}

export async function syncBuiltinSkills(force = false): Promise<SkillManifest> {
  if (syncPromise && !force) return syncPromise;

  const run = async (): Promise<SkillManifest> => {
    mkdirSync(OPENX_DIR, { recursive: true });
    cleanupSkillTempDirs();
    const manifest = loadSkillManifest();

    for (const source of BUILTIN_GITHUB_SKILLS) {
      const existing = manifest.skills[source.id];
      const destDir = join(getOpenxSkillsDir(), source.id);
      const hasFiles = existsSync(join(destDir, "SKILL.md"));
      if (!force && existing && !existing.error && hasFiles) continue;

      await installGithubSkill(manifest, source.id, githubSkillRemotePath(source));
    }

    saveSkillManifest(manifest);
    try {
      const settings = loadSettings();
      ensureWorkspaceSkillsLink(settings.workspaceRoot);
    } catch {
      /* ignore link errors on sync */
    }
    return manifest;
  };

  syncPromise = run().finally(() => {
    syncPromise = null;
  });
  return syncPromise;
}

export function listSkillCatalog(manifest?: SkillManifest): SkillCatalogEntry[] {
  return defaultSkillCatalog(manifest ?? loadSkillManifest());
}

export function ensureBuiltinSkillsOnStartup(): void {
  void syncBuiltinSkills()
    .then(() => {
      try {
        const settings = loadSettings();
        ensureWorkspaceSkillsLink(settings.workspaceRoot);
      } catch {
        /* ignore */
      }
    })
    .catch((err) => {
      console.warn("[skills] 内置 Obscura Skills 同步失败:", err instanceof Error ? err.message : err);
    });
}
