import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tmpProject } from "./helpers.js";
import { dirtyState, rollback, commitAll, git } from "../src/git.js";
import { verify, verifyCommands, baselineCommands } from "../src/verify.js";

const sh = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });

function gitProject(files) {
  const root = tmpProject(files);
  sh(root, "init", "-q");
  sh(root, "config", "user.email", "t@t");
  sh(root, "config", "user.name", "t");
  sh(root, "add", "-A");
  sh(root, "commit", "-qm", "init");
  return root;
}

test("commit messages are never interpreted by a shell", () => {
  const root = gitProject({ "a.txt": "1\n" });
  const marker = path.join(root, "pwned");
  fs.writeFileSync(path.join(root, "a.txt"), "2\n");
  const evil = `x "; touch ${marker}; echo " $(touch ${marker}) \`touch ${marker}\``;
  assert.equal(commitAll(root, evil, evil), true);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(git(root, ["log", "-1", "--format=%s"]), evil);
});

test("rollback reverts new changes but keeps pre-existing dirty files", () => {
  const root = gitProject({ "keep.txt": "orig\n", "edit.txt": "orig\n", "gone.txt": "orig\n" });
  fs.writeFileSync(path.join(root, "keep.txt"), "user work\n");
  const before = dirtyState(root);

  fs.writeFileSync(path.join(root, "edit.txt"), "agent\n");
  fs.writeFileSync(path.join(root, "new.txt"), "agent\n");
  fs.mkdirSync(path.join(root, "d"));
  fs.writeFileSync(path.join(root, "d/n.txt"), "agent\n");
  fs.rmSync(path.join(root, "gone.txt"));
  sh(root, "add", "new.txt");

  const reverted = rollback(root, before);
  assert.deepEqual(reverted.sort(), ["d/n.txt", "edit.txt", "gone.txt", "new.txt"]);
  assert.equal(fs.readFileSync(path.join(root, "edit.txt"), "utf8"), "orig\n");
  assert.equal(fs.readFileSync(path.join(root, "gone.txt"), "utf8"), "orig\n");
  assert.equal(fs.readFileSync(path.join(root, "keep.txt"), "utf8"), "user work\n");
  assert.equal(fs.existsSync(path.join(root, "new.txt")), false);
  assert.equal(fs.existsSync(path.join(root, "d/n.txt")), false);
});

test("rollback is a no-op outside git", () => {
  assert.deepEqual(rollback(tmpProject({ "a.txt": "x" }), new Map()), []);
});

test("verify reports failing commands; baseline keeps only passing ones", () => {
  const root = tmpProject({});
  const pass = "node -e process.exit(0)";
  const fail = "node -e console.error('boom');process.exit(1)";
  assert.equal(verify(root, [pass]).ok, true);
  const v = verify(root, [pass, fail]);
  assert.equal(v.ok, false);
  assert.equal(v.failures.length, 1);
  assert.match(v.failures[0].output, /boom/);
  assert.deepEqual(baselineCommands(root, [pass, fail, "definitely-not-a-binary"], 10_000), [pass]);
});

test("verifyCommands uses config override, else detected commands", () => {
  const fw = { commands: { test: "npm test", lint: "npm run lint", build: "npm run build" } };
  assert.deepEqual(verifyCommands(fw, {}), ["npm test", "npm run lint"]);
  assert.deepEqual(verifyCommands(fw, { verify: { commands: ["x"] } }), ["x"]);
});
