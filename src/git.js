import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** Run git without a shell. Returns trimmed stdout, or null on failure. */
export function git(root, args, { raw = false } = {}) {
  try {
    const out = execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    return raw ? out : out.trim();
  } catch {
    return null;
  }
}

export function isGitRepo(root) {
  return git(root, ["rev-parse", "--is-inside-work-tree"]) === "true";
}

function hasHead(root) {
  return git(root, ["rev-parse", "--verify", "-q", "HEAD"]) !== null;
}

/** Map of path -> porcelain status code for everything dirty in the tree. */
export function dirtyState(root) {
  const out = git(root, ["status", "--porcelain", "-z", "--untracked-files=all"], { raw: true });
  const map = new Map();
  if (!out) return map;
  const entries = out.split("\0");
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.length < 4) continue;
    const code = e.slice(0, 2);
    map.set(e.slice(3), code);
    if (code[0] === "R" || code[0] === "C") i += 1; // skip the rename source
  }
  return map;
}

/**
 * Undo everything a task changed. Paths that were already dirty before the
 * task started are left alone so the user's own work is never destroyed.
 * Returns the list of paths that were reverted.
 */
export function rollback(root, before) {
  if (!isGitRepo(root) || !hasHead(root)) return [];
  const reverted = [];
  for (const [file] of dirtyState(root)) {
    if (before.has(file)) continue;
    git(root, ["reset", "-q", "--", file]);
    if (git(root, ["cat-file", "-e", `HEAD:${file}`]) !== null) {
      git(root, ["checkout", "--", file]);
    } else {
      fs.rmSync(path.join(root, file), { force: true, recursive: true });
    }
    reverted.push(file);
  }
  return reverted;
}

/** Stage everything except codemender's own state and commit. */
export function commitAll(root, subject, body) {
  git(root, ["add", "-A", "--", ".", ":!.codemender"]);
  if (git(root, ["diff", "--cached", "--quiet"]) !== null) return false; // nothing staged
  return git(root, ["commit", "-q", "-m", subject, "-m", body]) !== null;
}
