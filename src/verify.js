import { spawnSync } from "node:child_process";
import { splitArgs } from "./tools.js";

const VERIFY_KEYS = ["test", "lint", "typecheck"];

/** Commands to use for verification: config override, else detected ones. */
export function verifyCommands(framework, config) {
  const custom = config.verify?.commands;
  if (Array.isArray(custom)) return custom;
  return VERIFY_KEYS.map((k) => framework.commands[k]).filter(Boolean);
}

export function runCommand(root, command, timeoutMs) {
  const [bin, ...args] = splitArgs(command);
  const res = spawnSync(bin, args, {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" },
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = `${res.stdout ?? ""}${res.stderr ? "\n" + res.stderr : ""}`.trim();
  return { ok: !res.error && res.status === 0, output: res.error ? res.error.message : output };
}

/** Run commands in order; returns { ok, failures: [{command, output}] }. */
export function verify(root, commands, timeoutMs = 300_000) {
  const failures = [];
  for (const command of commands) {
    const r = runCommand(root, command, timeoutMs);
    if (!r.ok) failures.push({ command, output: r.output.slice(-2000) });
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Commands that pass on the untouched project. Only these are enforced after
 * a task, so pre-existing failures don't make every task fail.
 */
export function baselineCommands(root, commands, timeoutMs) {
  return commands.filter((c) => runCommand(root, c, timeoutMs).ok);
}
