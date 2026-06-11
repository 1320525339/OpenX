import { parseSkillFrontmatter } from "./skills.js";

export type AgentCatalogEntry = {
  id: string;
  name: string;
  desc: string;
  agentMdPath?: string;
  /** 内置种子 Agent（coach / pi / reviewer） */
  builtin?: boolean;
};

/** AGENT.md frontmatter 与 SKILL.md 相同：name / description */
export function parseAgentFrontmatter(content: string): {
  name?: string;
  description?: string;
} {
  return parseSkillFrontmatter(content);
}

/** 去掉 YAML frontmatter，返回正文（rolePrompt） */
export function stripAgentFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}
