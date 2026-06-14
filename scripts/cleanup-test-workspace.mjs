/**
 * 清理 E2E / 单测产生的项目与对话（保留系统项目与会话）
 *
 * 用法：
 *   node scripts/cleanup-test-workspace.mjs
 *   node scripts/cleanup-test-workspace.mjs --dry-run
 */
const BASE = process.env.OPENX_BASE ?? "http://127.0.0.1:3921";
const dryRun = process.argv.includes("--dry-run");

const SYSTEM_PROJECT = "openx-system";
const SYSTEM_CONVERSATIONS = new Set(["openx-system-main", "openx-system-cli"]);

const TEST_PROJECT_RE =
  /^(crew-test|review-test|crew-e2e|e2e|test|p-crew|p-review|flow-|dispatch-)/i;
const TEST_CONV_TITLE_RE =
  /E2E|e2e|Debug-|Crew-|crew-|自测|bootstrap|browser_element|功能点|思考和审查|当前业务|Agent self/i;

async function json(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${path} → ${res.status}: ${body.error ?? res.statusText}`);
  }
  return body;
}

async function main() {
  console.log(`清理测试工作区 → ${BASE}${dryRun ? " (dry-run)" : ""}\n`);
  const { projects, conversations } = await json("/api/projects");

  const convsToDelete = conversations.filter(
    (c) =>
      !SYSTEM_CONVERSATIONS.has(c.id) &&
      (TEST_CONV_TITLE_RE.test(c.title) || TEST_PROJECT_RE.test(c.projectId)),
  );

  const projectsToDelete = projects.filter(
    (p) =>
      p.id !== SYSTEM_PROJECT &&
      (TEST_PROJECT_RE.test(p.id) ||
        TEST_PROJECT_RE.test(p.name) ||
        /^flow-\d+$/i.test(p.id) ||
        /^dispatch-\d+$/i.test(p.id) ||
        /^(self-test|review-thread)/i.test(p.name) ||
        (/test|e2e|crew|review|flow|dispatch/i.test(p.name) &&
          p.id !== SYSTEM_PROJECT)),
  );

  console.log(`待删对话: ${convsToDelete.length}`);
  for (const c of convsToDelete) {
    console.log(`  - [conv] ${c.title} (${c.id})`);
    if (!dryRun) await json(`/api/conversations/${encodeURIComponent(c.id)}`, { method: "DELETE" });
  }

  console.log(`待删项目: ${projectsToDelete.length}`);
  for (const p of projectsToDelete) {
    console.log(`  - [project] ${p.name} (${p.id})`);
    if (!dryRun) await json(`/api/projects/${encodeURIComponent(p.id)}`, { method: "DELETE" });
  }

  console.log(dryRun ? "\n(dry-run 未实际删除)" : "\n清理完成");
}

main().catch((err) => {
  console.error("清理失败:", err.message);
  process.exit(1);
});
