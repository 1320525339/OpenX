#!/usr/bin/env node
/**
 * 离线安装 Miloco Skills 到 ~/.openx/skills（无需 OpenX server 运行）
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = process.env.OPENX_SKILLS_DIR ?? join(homedir(), ".openx", "skills");
const MILOCO_SRC =
  process.env.OPENX_MILOCO_SKILLS_SRC?.trim() ??
  process.env.MILOCO_REPO?.trim() ??
  "d:/Miloco/plugins/skills";

const BATCH1 = ["miloco-devices", "miloco-miot-scope", "miloco-miot-admin"];

function prefix() {
  const p = join(ROOT, "scripts", "miloco-wsl.ps1").replace(/\\/g, "/");
  return `powershell -NoProfile -ExecutionPolicy Bypass -File "${p}"`;
}

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const to = join(dest, name);
    if (statSync(from).isDirectory()) copyDir(from, to);
    else {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
  }
}

function adapt(md) {
  const p = prefix();
  const adapter = [
    "## OpenX 执行约定（Windows / Pi）",
    "",
    `所有 miloco-cli 命令改为：\`${p} <参数>\``,
    "",
    "---",
    "",
  ].join("\n");
  let out = md.replace(/`miloco-cli /g, `\`${p} `).replace(/^miloco-cli /gm, `${p} `);
  const m = out.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (m) return out.slice(0, m[0].length) + adapter + out.slice(m[0].length);
  return adapter + out;
}

function parseFm(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const name = m[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = m[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return { name, description };
}

const srcRoot = resolve(MILOCO_SRC);
if (!existsSync(join(srcRoot, "miloco-devices", "SKILL.md"))) {
  console.error(`Miloco skills 源不存在: ${srcRoot}`);
  process.exit(1);
}

mkdirSync(SKILLS_DIR, { recursive: true });
const manifestPath = join(SKILLS_DIR, "manifest.json");
let manifest = { version: 1, skills: {} };
if (existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    /* fresh */
  }
}

for (const id of BATCH1) {
  const src = join(srcRoot, id);
  const dest = join(SKILLS_DIR, id);
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  copyDir(src, dest);
  const raw = readFileSync(join(src, "SKILL.md"), "utf8");
  const adapted = adapt(raw);
  writeFileSync(join(dest, "SKILL.md"), adapted, "utf8");
  const meta = parseFm(adapted);
  manifest.skills[id] = {
    id,
    dir: id,
    repo: "miloco-local",
    branch: "local",
    installedAt: new Date().toISOString(),
    skillMdPath: join(dest, "SKILL.md"),
    name: meta.name ?? id,
    description: meta.description,
  };
  console.log(`installed ${id}`);
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
console.log(`manifest: ${manifestPath}`);
