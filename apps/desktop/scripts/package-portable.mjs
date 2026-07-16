/**
 * 将已有的 Tauri 产物打成免安装 zip（解压即用）。
 *
 * 用法：
 *   node scripts/package-portable.mjs           # release
 *   node scripts/package-portable.mjs --debug   # 测试包（有控制台 + DevTools）
 *
 * 依赖先跑过：pnpm desktop:build 或 pnpm desktop:build:debug
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const isDebug = process.argv.includes("--debug");
const profile = isDebug ? "debug" : "release";
const buildDir = path.join(desktopRoot, "src-tauri", "target", profile);
const binariesDir = path.join(desktopRoot, "src-tauri", "binaries");
const outDir = path.join(buildDir, "bundle", "portable");
const version = "0.1.0";
const stageName = isDebug
  ? `OpenX_${version}_x64-debug-portable`
  : `OpenX_${version}_x64-portable`;
const stageDir = path.join(outDir, stageName);
const zipPath = path.join(outDir, `${stageName}.zip`);

const desktopExe = path.join(buildDir, "openx-desktop.exe");
const sidecarCandidates = [
  path.join(buildDir, "openx-server.exe"),
  path.join(binariesDir, "openx-server-x86_64-pc-windows-msvc.exe"),
];
const sidecarSrc = sidecarCandidates.find((p) => existsSync(p));
const piRunnerSrc = existsSync(path.join(binariesDir, "pi-child-runner.cjs"))
  ? path.join(binariesDir, "pi-child-runner.cjs")
  : path.join(buildDir, "pi-child-runner.cjs");
const nodeModulesSrc = existsSync(path.join(binariesDir, "node_modules"))
  ? path.join(binariesDir, "node_modules")
  : path.join(buildDir, "node_modules");

function fail(msg) {
  console.error(`[portable] ${msg}`);
  process.exit(1);
}

if (!existsSync(desktopExe)) {
  fail(
    `缺少 ${desktopExe}，请先执行 pnpm desktop:build${isDebug ? ":debug" : ""}`,
  );
}
if (!sidecarSrc) {
  fail("缺少 openx-server sidecar，请先执行 pnpm --filter @openx/desktop build:server");
}
if (!existsSync(piRunnerSrc)) {
  fail(`缺少 pi-child-runner.cjs`);
}
if (!existsSync(nodeModulesSrc)) {
  fail(`缺少 sidecar node_modules（${nodeModulesSrc}）`);
}

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

console.log(`[portable] staging (${profile}) …`);
cpSync(desktopExe, path.join(stageDir, "OpenX.exe"));
cpSync(sidecarSrc, path.join(stageDir, "openx-server.exe"));
cpSync(piRunnerSrc, path.join(stageDir, "pi-child-runner.cjs"));
cpSync(nodeModulesSrc, path.join(stageDir, "node_modules"), { recursive: true });

const readmeLines = isDebug
  ? [
      "OpenX 测试包（debug / 可看日志）",
      "",
      "本包特性：",
      "- 启动时会弹出黑色控制台窗口（桌面壳 + sidecar 日志）",
      "- 主窗口会自动打开 WebView DevTools",
      "- 托盘应只有 1 个 OpenX 图标（已修双图标）",
      "",
      "使用方法：",
      "1. 解压后双击 OpenX.exe",
      "2. 数据目录仍为 %USERPROFILE%\\.openx\\",
      "",
      "需要系统已安装 Microsoft Edge WebView2 Runtime。",
      "",
    ]
  : [
      "OpenX 免安装版",
      "",
      "使用方法：",
      "1. 解压本目录到任意位置",
      "2. 双击 OpenX.exe 启动",
      "3. 数据目录仍为 %USERPROFILE%\\.openx\\",
      "",
      "需要系统已安装 Microsoft Edge WebView2 Runtime。",
      "Miloco 等拓展在「工具 → 拓展中心」中启用。",
      "",
    ];

writeFileSync(path.join(stageDir, "README.txt"), readmeLines.join("\r\n"), "utf8");

mkdirSync(outDir, { recursive: true });
if (existsSync(zipPath)) rmSync(zipPath);

const ps = [
  `$ErrorActionPreference = 'Stop'`,
  `Compress-Archive -Path '${stageDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
].join("; ");

console.log("[portable] zipping …");
execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps}"`, {
  stdio: "inherit",
});

console.log(`[portable] ✓ ${zipPath}`);
console.log(`[portable] 解压目录也可直接用：${stageDir}`);
