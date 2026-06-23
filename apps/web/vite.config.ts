import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const crewGameRoot = path.resolve(webRoot, "../server/e2e-crew-game");

const CREW_GAME_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** 开发态挂载 e2e-crew-game 打砖块示例，供拓展槽 iframe 测试 */
function crewGameDemoPlugin(): Plugin {
  return {
    name: "openx-crew-game-demo",
    configureServer(server) {
      mountCrewGame(server.middlewares);
    },
    configurePreviewServer(server) {
      mountCrewGame(server.middlewares);
    },
  };
}

function mountCrewGame(
  middlewares: { use: (path: string, handler: (...args: unknown[]) => void) => void },
) {
  middlewares.use("/demo/crew-game", (req, res, next) => {
        const rawPath = (req.url ?? "/").split("?")[0] ?? "/";
        const rel = rawPath === "/" ? "/index.html" : rawPath;
        const filePath = path.normalize(path.join(crewGameRoot, rel));
        if (!filePath.startsWith(crewGameRoot)) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          next();
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.setHeader("Content-Type", CREW_GAME_MIME[ext] ?? "application/octet-stream");
        fs.createReadStream(filePath).pipe(res);
      });
}

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ["@onlook/babel-plugin-react"],
      },
    }),
    crewGameDemoPlugin(),
  ],
  // Tauri 兼容：允许 TAURI_ENV_* 环境变量传入前端
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  // Tauri 兼容：防止清除 Rust 编译错误
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3921",
        changeOrigin: true,
        ws: true,
        timeout: 120_000,
        proxyTimeout: 120_000,
      },
      "/internal": {
        target: "http://127.0.0.1:3921",
        changeOrigin: true,
        timeout: 120_000,
        proxyTimeout: 120_000,
      },
    },
    watch: {
      // Tauri 兼容：忽略 src-tauri 目录变更
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // Tauri 在 Windows 上使用 WebView2 (Chromium)
    target: process.env.TAURI_ENV_PLATFORM === "windows"
      ? "chrome105"
      : process.env.TAURI_ENV_PLATFORM
        ? "safari13"
        : undefined,
    // debug 模式不压缩
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
