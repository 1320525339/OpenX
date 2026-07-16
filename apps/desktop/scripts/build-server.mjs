/**
 * OpenX Server Sidecar 构建脚本
 *
 * 流程:
 *   1. esbuild 将 ESM server 打包为单文件 CJS bundle
 *   2. @yao-pkg/pkg 将 CJS bundle 编译为 Windows .exe
 *   3. 复制 better-sqlite3 .node 到 binaries/
 *   4. 重命名为 Tauri sidecar 命名格式
 */
import { execSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const monorepoRoot = path.resolve(desktopRoot, "../..");
const binariesDir = path.join(desktopRoot, "src-tauri", "binaries");
const distDir = path.join(desktopRoot, "dist");

// 确保目录存在
for (const dir of [binariesDir, distDir]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

const TARGET_TRIPLE = "x86_64-pc-windows-msvc";
const SIDECAR_NAME = "openx-server";
const SIDECAR_EXE = `${SIDECAR_NAME}-${TARGET_TRIPLE}.exe`;
const BUNDLE_PATH = path.join(distDir, "server-bundle.cjs");
const PI_CHILD_BUNDLE = path.join(distDir, "pi-child-runner.cjs");
const PKG_OUTPUT = path.join(distDir, "openx-server.exe");

const PKG_EXTERNALS = [
  "better-sqlite3",
  "puppeteer-core",
  "bufferutil",
  "utf-8-validate",
  "node:sqlite",
  "undici",
  // 原生 addon：pkg snapshot 无法正确解析其 ./index.js / .node
  "@zvec/zvec",
  "@zvec/bindings-win32-x64",
  "@zvec/bindings-darwin-arm64",
  "@zvec/bindings-linux-arm64",
  "@zvec/bindings-linux-x64",
];

const PKG_BANNER = {
  js: [
    `(function(){`,
    `if (process.pkg) {`,
    `  const path = require("path");`,
    `  const base = path.dirname(process.execPath);`,
    `  const nodeModules = path.join(base, "node_modules");`,
    `  process.env.NODE_PATH = [nodeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);`,
    `  require("module").Module._initPaths();`,
    `}`,
    `})();`,
    `const __IMPORT_META_URL__ = require("url").pathToFileURL(__filename).href;`,
  ].join("\n"),
};

/** pi-ai 在 pkg snapshot 中不能用 dynamic import()，改为 require */
function piPkgPlugin() {
  return {
    name: "pi-pkg-compat",
    setup(build) {
      build.onLoad({ filter: /pi-ai.*\.js$/ }, (args) => {
        if (!args.path.includes("@earendil-works")) return null;
        let contents = readFileSync(args.path, "utf8");
        if (!contents.includes("import(")) return null;
        contents = contents.replace(
          /const dynamicImport = \(specifier\) => import\(__rewriteRelativeImportExtension\(specifier\)\);/g,
          "const dynamicImport = (specifier) => Promise.resolve(require(specifier));",
        );
        contents = contents.replace(
          /\bimport\((["'`])(node:[^"'`]+)\1\)/g,
          "Promise.resolve(require($1$2$1))",
        );
        return { contents, loader: "js" };
      });
    },
  };
}

function patchPkgBundle(bundlePath) {
  let bundleContent = readFileSync(bundlePath, "utf-8");
  const before = bundleContent;
  bundleContent = bundleContent.replace(
    /require\(["']node:sqlite["']\)/g,
    '(function(){try{return module.constructor._load("node:sqlite")}catch(e){throw new Error("node:sqlite not available: better-sqlite3 is required")}})()',
  );
  if (bundleContent !== before) {
    writeFileSync(bundlePath, bundleContent);
    console.log(`  ✓ patched node:sqlite in ${path.basename(bundlePath)}`);
  }
}

async function buildEsbuildBundle({ entry, outfile, alias, plugins = [] }) {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile,
    define: { "import.meta.url": "__IMPORT_META_URL__" },
    banner: PKG_BANNER,
    external: PKG_EXTERNALS,
    alias,
    plugins,
    treeShaking: true,
    logLevel: "warning",
  });
  patchPkgBundle(outfile);
  console.log(`  → ${outfile}`);
}

// ============================================================
// Step 1: esbuild — 主 server + Pi 子进程 runner
// ============================================================
console.log("\n[1/4] esbuild: bundling server + pi-child-runner ...");

for (const f of [BUNDLE_PATH, PI_CHILD_BUNDLE]) {
  if (existsSync(f)) rmSync(f);
}

try {
  await buildEsbuildBundle({
    entry: path.join(monorepoRoot, "apps/server/src/index.ts"),
    outfile: BUNDLE_PATH,
    alias: {
      "@openx/executor-pi": path.join(monorepoRoot, "apps/server/src/pi-pkg-stub.ts"),
    },
  });
  await buildEsbuildBundle({
    entry: path.join(monorepoRoot, "apps/server/src/pi-child-runner.ts"),
    outfile: PI_CHILD_BUNDLE,
    plugins: [piPkgPlugin()],
  });
} catch (err) {
  console.error("esbuild failed:", err);
  process.exit(1);
}

// ============================================================
// Step 2: pkg — CJS bundle → Windows .exe
// ============================================================
console.log("\n[2/4] pkg: compiling CJS bundle → exe ...");

try {
  execSync(
    [
      "npx", "@yao-pkg/pkg",
      BUNDLE_PATH,
      "--targets", "node20-win-x64",
      "--output", PKG_OUTPUT,
    ].join(" "),
    { cwd: desktopRoot, stdio: "inherit" },
  );
  console.log(`  → ${PKG_OUTPUT}`);
} catch (err) {
  console.error("pkg failed:", err.message);
  process.exit(1);
}

// ============================================================
// Step 3: 复制 sidecar + native addon 到 Tauri binaries/
// ============================================================
console.log("\n[3/4] Copying binaries to src-tauri/binaries/ ...");

// 3a. 复制 .exe + pi-child-runner.cjs
const destExe = path.join(binariesDir, SIDECAR_EXE);
copyFileSync(PKG_OUTPUT, destExe);
console.log(`  → ${destExe}`);
const destPiChild = path.join(binariesDir, "pi-child-runner.cjs");
copyFileSync(PI_CHILD_BUNDLE, destPiChild);
console.log(`  → ${destPiChild}`);

// 3b. 查找并复制 better-sqlite3 .node 文件
const sqlite3NodePaths = [
  path.join(monorepoRoot, "node_modules/.pnpm"),
  path.join(monorepoRoot, "apps/server/node_modules"),
  path.join(monorepoRoot, "node_modules"),
];

let nodeFileFound = false;
for (const searchBase of sqlite3NodePaths) {
  if (!existsSync(searchBase)) continue;
  const found = findFile(searchBase, "better_sqlite3.node", 5);
  if (found) {
    const destNode = path.join(binariesDir, "better_sqlite3.node");
    copyFileSync(found, destNode);
    console.log(`  → ${destNode} (from ${found})`);
    nodeFileFound = true;
    break;
  }
}

if (!nodeFileFound) {
  console.warn(
    "  ⚠ better_sqlite3.node not found! The sidecar will fail at runtime.\n" +
    "    Run `pnpm install` first to ensure native modules are built.",
  );
}

// ============================================================
// Step 4: 复制 sidecar 运行时 node_modules（pkg 外部 native 模块）
// ============================================================
console.log("\n[4/4] Preparing sidecar node_modules ...");

const sidecarNodeModules = path.join(binariesDir, "node_modules");
if (existsSync(sidecarNodeModules)) rmSync(sidecarNodeModules, { recursive: true, force: true });
mkdirSync(sidecarNodeModules, { recursive: true });

const serverRequire = createRequire(path.join(monorepoRoot, "apps/server/package.json"));
const sqliteRequire = createRequire(
  path.join(path.dirname(serverRequire.resolve("better-sqlite3/package.json")), "package.json"),
);

function copyPackage(name, resolver) {
  const srcDir = path.dirname(resolver.resolve(`${name}/package.json`));
  const destDir = path.join(sidecarNodeModules, name);
  cpSync(srcDir, destDir, { recursive: true });
  console.log(`  → node_modules/${name}`);
}

/** 在 pnpm store 中定位包的 virtual node_modules 目录 */
function resolvePnpmVirtualNodeModules(packageName) {
  const pnpmDir = path.join(monorepoRoot, "node_modules/.pnpm");
  const folderPrefix = `${packageName.replace(/\//g, "+")}@`;
  for (const entry of readdirSync(pnpmDir)) {
    if (!entry.startsWith(folderPrefix)) continue;
    const candidate = path.join(
      pnpmDir,
      entry,
      "node_modules",
      ...packageName.split("/"),
      "package.json",
    );
    if (!existsSync(candidate)) continue;
    let dir = path.dirname(candidate);
    while (path.basename(dir) !== "node_modules") {
      dir = path.dirname(dir);
    }
    return dir;
  }
  throw new Error(`Cannot find ${packageName} in pnpm store (run pnpm install)`);
}

function packagePathInNodeModules(nodeModulesRoot, packageName) {
  return path.join(nodeModulesRoot, ...packageName.split("/"));
}

/** 递归复制 external 包及其 transitive deps 的 pnpm scope */
function copyRuntimePackageTree(packageNames, destRoot) {
  const copiedScopes = new Set();
  const queued = new Set();
  const queue = [...packageNames];

  while (queue.length > 0) {
    const packageName = queue.shift();
    if (queued.has(packageName)) continue;
    queued.add(packageName);

    let virtualNodeModules;
    try {
      virtualNodeModules = resolvePnpmVirtualNodeModules(packageName);
    } catch {
      console.warn(`  ⚠ skip missing runtime dep: ${packageName}`);
      continue;
    }

    if (!copiedScopes.has(virtualNodeModules)) {
      copiedScopes.add(virtualNodeModules);
      for (const entry of readdirSync(virtualNodeModules)) {
        if (entry.startsWith(".")) continue;
        const src = path.join(virtualNodeModules, entry);
        const dest = path.join(destRoot, entry);
        // scoped 包（@zvec 等）必须合并子目录，不能整夹覆盖
        if (entry.startsWith("@") && existsSync(dest)) {
          for (const pkg of readdirSync(src)) {
            const pkgSrc = path.join(src, pkg);
            const pkgDest = path.join(dest, pkg);
            if (existsSync(pkgDest)) rmSync(pkgDest, { recursive: true, force: true });
            cpSync(pkgSrc, pkgDest, { recursive: true, dereference: true });
            console.log(`  → node_modules/${entry}/${pkg}`);
          }
        } else {
          if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
          cpSync(src, dest, { recursive: true, dereference: true });
          console.log(`  → node_modules/${entry}`);
        }
      }
    }

    const pkgJsonPath = path.join(
      packagePathInNodeModules(virtualNodeModules, packageName),
      "package.json",
    );
    if (!existsSync(pkgJsonPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    for (const dep of Object.keys({
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
    })) {
      if (!queued.has(dep)) queue.push(dep);
    }
  }
}

let sidecarModulesOk = true;
try {
  copyPackage("better-sqlite3", serverRequire);
  copyPackage("bindings", sqliteRequire);
  copyPackage("file-uri-to-path", sqliteRequire);
  copyRuntimePackageTree(
    ["undici", "puppeteer-core", "@zvec/zvec", "@zvec/bindings-win32-x64"],
    sidecarNodeModules,
  );
} catch (err) {
  sidecarModulesOk = false;
  console.error("  ✗ failed to prepare sidecar node_modules:", err.message ?? err);
}

const sidecarNative = path.join(sidecarNodeModules, "better-sqlite3", "build", "Release", "better_sqlite3.node");
if (!existsSync(sidecarNative)) {
  sidecarModulesOk = false;
  console.error(`  ✗ missing ${sidecarNative}`);
} else {
  console.log(`  ✓ native binding: ${sidecarNative}`);
}

const zvecPkg = path.join(sidecarNodeModules, "@zvec", "zvec", "package.json");
const zvecWinBinding = path.join(
  sidecarNodeModules,
  "@zvec",
  "bindings-win32-x64",
  "zvec_node_binding.node",
);
if (!existsSync(zvecPkg)) {
  sidecarModulesOk = false;
  console.error(`  ✗ missing ${zvecPkg}`);
} else if (!existsSync(zvecWinBinding)) {
  sidecarModulesOk = false;
  console.error(`  ✗ missing ${zvecWinBinding}`);
} else {
  console.log(`  ✓ zvec binding: ${zvecWinBinding}`);
}

// pkg 内嵌 Node 20 — 将 better-sqlite3 重编译为匹配的 NODE_MODULE_VERSION
console.log("\n[4b] Rebuilding better-sqlite3 for pkg Node 20 ...");
const sqlitePkgDir = path.join(sidecarNodeModules, "better-sqlite3");
try {
  execSync(
    [
      "npx", "node-gyp", "rebuild",
      "--directory", sqlitePkgDir,
      "--target=20.18.0",
      "--arch=x64",
      "--dist-url=https://nodejs.org/dist",
    ].join(" "),
    { cwd: desktopRoot, stdio: "inherit" },
  );
  console.log("  ✓ better-sqlite3 rebuilt for Node 20.18.0");
} catch (err) {
  sidecarModulesOk = false;
  console.error("  ✗ better-sqlite3 rebuild failed:", err.message ?? err);
}

if (!sidecarModulesOk) {
  console.error("\nSidecar node_modules incomplete; run `pnpm install` in the repo root and retry.");
  process.exit(1);
}

console.log("\n✅ Server sidecar build complete!");
console.log(`   Sidecar: ${path.join(binariesDir, SIDECAR_EXE)}`);
if (nodeFileFound) {
  console.log(`   Native:  ${path.join(binariesDir, "better_sqlite3.node")}`);
}

// ============================================================
// Helpers
// ============================================================
function findFile(dir, filename, maxDepth) {
  if (maxDepth <= 0) return null;
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry === filename) {
        return path.join(dir, entry);
      }
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          const found = findFile(full, filename, maxDepth - 1);
          if (found) return found;
        }
      } catch {
        // skip inaccessible
      }
    }
  } catch {
    // skip
  }
  return null;
}
