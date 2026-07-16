import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MILOCO_BATCH3_ONLY_SKILL_IDS,
  MILOCO_SKILL_REPO_LABEL,
  MILOCO_SYNC_SKILL_IDS,
  milocoCliCommandPrefix,
  defaultMilocoSkillBindings,
  type SkillManifest,
} from "@openx/shared";
import { getOpenxSkillsDir } from "@openx/shared/skills-path";
import { loadSkillManifest } from "./skills-service.js";
import { loadSettings, saveSettings } from "./settings-store.js";
import { getOrCreateMilocoWebhookToken } from "./miloco-webhook-auth.js";
import { parseSkillFrontmatter } from "@openx/shared";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const OPENX_ROOT = process.env.OPENX_ROOT ?? resolve(SERVER_DIR, "../../..");

function manifestPath(): string {
  return join(getOpenxSkillsDir(), "manifest.json");
}

function saveSkillManifest(manifest: SkillManifest): void {
  mkdirSync(getOpenxSkillsDir(), { recursive: true });
  writeFileSync(manifestPath(), JSON.stringify(manifest, null, 2), "utf8");
}

function resolveMilocoSkillsSource(): string | null {
  const candidates = [
    process.env.OPENX_MILOCO_SKILLS_SRC?.trim(),
    process.env.MILOCO_REPO?.trim(),
    "d:/Miloco/plugins/skills",
    "D:/Miloco/plugins/skills",
    join(OPENX_ROOT, "packages/miloco-skills/source"),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const root = resolve(candidate);
    if (existsSync(join(root, "miloco-devices", "SKILL.md"))) {
      return root;
    }
  }
  return null;
}

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const to = join(dest, name);
    if (statSync(from).isDirectory()) {
      copyDirRecursive(from, to);
    } else {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
  }
}

function adaptSkillMarkdown(body: string, openxRoot: string, skillId: string): string {
  const prefix = milocoCliCommandPrefix(openxRoot);
  const adapter = [
    "## OpenX 执行约定（Windows / Pi）",
    "",
    "本 Skill 在 OpenX 中由内置 **Pi Agent** 执行。所有原 `miloco-cli` 命令统一改为：",
    "",
    "```",
    `${prefix} <子命令与参数>`,
    "```",
    "",
    "示例：`miloco-cli device list` →",
    "",
    "```",
    `${prefix} device list`,
    "```",
    "",
    "服务未运行时先执行：",
    "",
    "```",
    `${prefix} service start`,
    "```",
    "",
    "---",
    "",
  ].join("\n");

  let adapted = body;
  // 将正文中的 miloco-cli 调用替换为 WSL 包装（保留文档中的反引号命令）
  adapted = adapted.replace(/`miloco-cli /g, `\`${prefix} `);
  adapted = adapted.replace(/\$ miloco-cli /g, `$ ${prefix} `);
  adapted = adapted.replace(/^miloco-cli /gm, `${prefix} `);

  const batch3Ids = new Set<string>(MILOCO_BATCH3_ONLY_SKILL_IDS);
  const batch3Note = batch3Ids.has(skillId)
    ? [
        "## OpenX 批次三说明",
        "",
        "- 家庭 Cron 由 OpenX `miloco-home-cron-watchdog` 触发（`OPENX_MILOCO_HOME_CRON_WATCH=1`）",
        "- Cron Goal 在会话 `openx-miloco-cron` 执行",
        "- `miloco_habit_suggest(action=...)` → `curl -s -X POST http://127.0.0.1:3921/api/miloco/habit-suggest -H Content-Type:application/json -d '{\"action\":\"...\"}'`",
        "- `miloco_im_push` → `${prefix} notify push --text \"...\"`",
        "",
        "---",
        "",
      ].join("\n")
    : "";

  // 在 frontmatter 后插入适配说明
  const fmMatch = adapted.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (fmMatch) {
    const end = fmMatch[0].length;
    return adapted.slice(0, end) + adapter + batch3Note + adapted.slice(end);
  }
  return adapter + batch3Note + adapted;
}

function installMilocoSkill(
  manifest: SkillManifest,
  skillId: string,
  sourceRoot: string,
  openxRoot: string,
): void {
  const srcDir = join(sourceRoot, skillId);
  const destDir = join(getOpenxSkillsDir(), skillId);
  const skillMd = join(srcDir, "SKILL.md");

  if (!existsSync(skillMd)) {
    throw new Error(`Miloco skill 源缺失: ${skillMd}`);
  }

  if (existsSync(destDir)) {
    rmSync(destDir, { recursive: true, force: true });
  }
  copyDirRecursive(srcDir, destDir);

  const raw = readFileSync(skillMd, "utf8");
  const adapted = adaptSkillMarkdown(raw, openxRoot, skillId);
  writeFileSync(join(destDir, "SKILL.md"), adapted, "utf8");

  const meta = parseSkillFrontmatter(adapted);
  manifest.skills[skillId] = {
    id: skillId,
    dir: skillId,
    repo: MILOCO_SKILL_REPO_LABEL,
    branch: "local",
    installedAt: new Date().toISOString(),
    skillMdPath: join(destDir, "SKILL.md"),
    name: meta.name ?? skillId,
    description: meta.description,
  };
}

export type MilocoSkillsSyncResult = {
  ok: boolean;
  installed: string[];
  source: string | null;
  error?: string;
};

export function syncMilocoSkills(force = false): MilocoSkillsSyncResult {
  const sourceRoot = resolveMilocoSkillsSource();
  if (!sourceRoot) {
    return {
      ok: false,
      installed: [],
      source: null,
      error:
        "未找到 Miloco Skills 源。请设置 OPENX_MILOCO_SKILLS_SRC 或克隆 xiaomi-miloco 到 d:/Miloco",
    };
  }

  try {
    mkdirSync(getOpenxSkillsDir(), { recursive: true });
    const manifest = loadSkillManifest();
    const installed: string[] = [];

    for (const skillId of MILOCO_SYNC_SKILL_IDS) {
      const destMd = join(getOpenxSkillsDir(), skillId, "SKILL.md");
      const existing = manifest.skills[skillId];
      if (!force && existing && !existing.error && existsSync(destMd)) {
        installed.push(skillId);
        continue;
      }
      installMilocoSkill(manifest, skillId, sourceRoot, OPENX_ROOT);
      installed.push(skillId);
    }

    saveSkillManifest(manifest);
    return { ok: true, installed, source: sourceRoot };
  } catch (err) {
    return {
      ok: false,
      installed: [],
      source: sourceRoot,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function applyMilocoSkillBindings(): void {
  const settings = loadSettings();
  const nextBindings = defaultMilocoSkillBindings(settings.skillBindings ?? {});
  if (JSON.stringify(nextBindings) === JSON.stringify(settings.skillBindings ?? {})) {
    return;
  }
  saveSettings({ ...settings, skillBindings: nextBindings });
}

export function ensureMilocoIntegrationOnStartup(): void {
  getOrCreateMilocoWebhookToken();
  const result = syncMilocoSkills(false);
  if (result.ok) {
    applyMilocoSkillBindings();
    if (result.installed.length > 0) {
      console.log(
        `[miloco] Skills 已就绪: ${result.installed.join(", ")} (源: ${result.source})`,
      );
    }
  } else if (result.error && process.env.OPENX_MILOCO_VERBOSE === "1") {
    console.warn(`[miloco] Skills 同步跳过: ${result.error}`);
  }
}
