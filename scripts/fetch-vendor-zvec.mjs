#!/usr/bin/env node
/**
 * 将 alibaba/zvec 拉取到 vendors/zvec（示例库，已在 .gitignore）
 * 用法：node scripts/fetch-vendor-zvec.mjs
 */
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "vendors", "zvec");
const repo = "https://github.com/alibaba/zvec.git";

mkdirSync(join(root, "vendors"), { recursive: true });

if (existsSync(join(target, ".git"))) {
  console.log("[zvec] 已存在，执行 git pull …");
  execSync("git pull --ff-only", { cwd: target, stdio: "inherit" });
} else if (existsSync(target)) {
  console.error(`[zvec] 目录已存在但非 git 仓库：${target}`);
  process.exit(1);
} else {
  console.log(`[zvec] 克隆 ${repo} → vendors/zvec`);
  execSync(`git clone --depth 1 ${repo} "${target}"`, { stdio: "inherit", cwd: root });
}

console.log("[zvec] 完成。路径：vendors/zvec（只读参考，见 AGENTS.md）");
