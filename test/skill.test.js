import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installSkill, SKILL_SOURCE } from "../src/skill.js";

function frontmatter(file) {
  const m = fs.readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, "SKILL.md must start with YAML frontmatter");
  return m[1];
}

test("bundled SKILL.md has valid name and description", () => {
  const fm = frontmatter(path.join(SKILL_SOURCE, "SKILL.md"));
  assert.match(fm, /^name: codemender$/m);
  const desc = fm.match(/^description: (.+)$/m)?.[1] ?? "";
  assert.ok(desc.length > 50 && desc.length <= 1024, "description must be 1-1024 chars");
});

test("installSkill copies the skill for every agent in project scope", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cm-skill-"));
  const res = installSkill({ root });
  for (const rel of [".claude/skills", ".agents/skills", ".agent/skills", ".gemini/skills"]) {
    assert.ok(fs.existsSync(path.join(root, rel, "codemender/SKILL.md")), rel);
    assert.ok(fs.existsSync(path.join(root, rel, "codemender/references/cli.md")), rel);
  }
  assert.equal(new Set(res.map((r) => r.dir)).size, res.length, "no duplicate dirs");
  assert.ok(installSkill({ root, agents: ["claude"] })[0].updated);
});

test("installSkill global scope uses home and rejects unknown agents", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cm-home-"));
  installSkill({ agents: ["codex", "antigravity"], scope: "global", home });
  assert.ok(fs.existsSync(path.join(home, ".codex/skills/codemender/SKILL.md")));
  assert.ok(fs.existsSync(path.join(home, ".gemini/antigravity/skills/codemender/SKILL.md")));
  assert.throws(() => installSkill({ agents: ["nope"], home }), /Unknown agent/);
});
