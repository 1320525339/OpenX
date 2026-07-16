import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ProjectReadinessLevel =
  | "ready"
  | "partial"
  | "missing"
  | "unknown";

export type ProjectReadinessReport = {
  level: ProjectReadinessLevel;
  score: number;
  checkedAt: string;
  workspaceRoot: string;
  checks: Array<{
    id: string;
    label: string;
    ok: boolean;
    detail?: string;
  }>;
  gaps: string[];
};

function hasAny(root: string, names: string[]): string | undefined {
  for (const name of names) {
    if (existsSync(join(root, name))) return name;
  }
  return undefined;
}

/**
 * 审计工作区是否具备自主交付闭环（对标 agent-kanban Quality Loop）。
 * 纯本地文件检查，不调用 LLM。
 */
export function auditProjectReadiness(workspaceRoot: string): ProjectReadinessReport {
  const root = workspaceRoot.trim() || ".";
  const checks: ProjectReadinessReport["checks"] = [];

  const agents = hasAny(root, ["AGENTS.md", "agents.md", ".cursorrules"]);
  checks.push({
    id: "agents_md",
    label: "Agent 说明文档",
    ok: Boolean(agents),
    detail: agents ?? "缺少 AGENTS.md",
  });

  const pkg = hasAny(root, ["package.json", "pyproject.toml", "Cargo.toml", "go.mod"]);
  checks.push({
    id: "package_manifest",
    label: "项目清单",
    ok: Boolean(pkg),
    detail: pkg ?? "未发现 package.json / pyproject.toml 等",
  });

  let hasTestScript = false;
  if (pkg === "package.json") {
    try {
      const raw = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      };
      hasTestScript = Boolean(raw.scripts?.test || raw.scripts?.["test:unit"]);
    } catch {
      hasTestScript = false;
    }
  }
  const testDir = hasAny(root, ["tests", "test", "__tests__", "spec"]);
  checks.push({
    id: "tests",
    label: "可重复验证",
    ok: hasTestScript || Boolean(testDir),
    detail: hasTestScript
      ? "package.json 含 test 脚本"
      : testDir
        ? `存在 ${testDir}/`
        : "缺少 test 脚本或 tests 目录",
  });

  const ci = hasAny(root, [
    ".github/workflows",
    ".gitlab-ci.yml",
    "azure-pipelines.yml",
  ]);
  checks.push({
    id: "ci",
    label: "CI 工作流",
    ok: Boolean(ci),
    detail: ci ?? "缺少 CI 配置",
  });

  const docs = hasAny(root, ["README.md", "docs", "docs/adr"]);
  checks.push({
    id: "docs",
    label: "行为/产品文档",
    ok: Boolean(docs),
    detail: docs ?? "缺少 README/docs",
  });

  const okCount = checks.filter((c) => c.ok).length;
  const score = Math.round((okCount / checks.length) * 100);
  const gaps = checks.filter((c) => !c.ok).map((c) => c.detail ?? c.label);
  let level: ProjectReadinessLevel = "unknown";
  if (checks.length === 0) level = "unknown";
  else if (okCount === checks.length) level = "ready";
  else if (okCount >= 3) level = "partial";
  else level = "missing";

  return {
    level,
    score,
    checkedAt: new Date().toISOString(),
    workspaceRoot: root,
    checks,
    gaps,
  };
}

export function readinessBadgeLabel(level: ProjectReadinessLevel): string {
  switch (level) {
    case "ready":
      return "就绪";
    case "partial":
      return "部分就绪";
    case "missing":
      return "未就绪";
    default:
      return "未知";
  }
}
