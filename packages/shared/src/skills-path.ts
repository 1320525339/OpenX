import { join } from "node:path";
import { resolveOpenxHome } from "./openx-home.js";

/** OpenX 本地 Skills 安装目录（仅 Node 运行时；浏览器请用 API 返回的 skillsDir） */
export function getOpenxSkillsDir(): string {
  const override = process.env.OPENX_SKILLS_DIR?.trim();
  if (override) return override;
  return join(resolveOpenxHome(), "skills");
}
