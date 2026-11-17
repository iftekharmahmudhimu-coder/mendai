import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_NAME = "mendai";
export const SKILL_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "skills", SKILL_NAME);

/**
 * Where each agent looks for Agent Skills (SKILL.md folders).
 * project: relative to the project root; global: relative to the home directory.
 */
export const SKILL_TARGETS = {
  claude: { label: "Claude Code", project: [".claude/skills"], global: [".claude/skills"] },
  codex: { label: "OpenAI Codex", project: [".agents/skills"], global: [".agents/skills", ".codex/skills"] },
  antigravity: { label: "Google Antigravity", project: [".agent/skills", ".agents/skills"], global: [".gemini/antigravity/skills"] },
  gemini: { label: "Gemini CLI", project: [".gemini/skills"], global: [".gemini/skills"] },
  agents: { label: "Generic (.agents/skills)", project: [".agents/skills"], global: [".agents/skills"] },
};

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/**
 * Copy the bundled skill into the chosen agents' skill folders.
 * @param {{ agents?: string[], scope?: "project"|"global", root?: string, home?: string }} opts
 * @returns {{ agent: string, label: string, dir: string, updated: boolean }[]}
 */
export function installSkill({ agents = Object.keys(SKILL_TARGETS), scope = "project", root = process.cwd(), home = os.homedir() } = {}) {
  if (!fs.existsSync(path.join(SKILL_SOURCE, "SKILL.md"))) throw new Error(`Skill source not found at ${SKILL_SOURCE}`);
  const unknown = agents.filter((a) => !SKILL_TARGETS[a]);
  if (unknown.length) throw new Error(`Unknown agent(s): ${unknown.join(", ")}. Choose from: ${Object.keys(SKILL_TARGETS).join(", ")}, all`);

  const base = scope === "global" ? home : root;
  const done = new Set();
  const results = [];
  for (const agent of agents) {
    const { label, [scope]: dirs } = SKILL_TARGETS[agent];
    for (const rel of dirs) {
      const dir = path.join(base, rel, SKILL_NAME);
      if (done.has(dir)) continue;
      done.add(dir);
      const updated = fs.existsSync(dir);
      copyDir(SKILL_SOURCE, dir);
      results.push({ agent, label, dir, updated });
    }
  }
  return results;
}
