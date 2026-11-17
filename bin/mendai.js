#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run, scan } from "../src/runner.js";
import { watch } from "../src/watcher.js";
import { loadConfig, writeDefaultConfig, apiKeyEnvFor, CONFIG_FILE } from "../src/config.js";
import { detectFramework, allowedCommandPrefixes } from "../src/framework.js";
import { ensureLocalModel } from "../src/setup.js";
import { createLogger } from "../src/logger.js";
import { createProvider, resolveProviders } from "../src/providers/index.js";
import { installSkill, SKILL_TARGETS } from "../src/skill.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8"));

const HELP = `mendai v${pkg.version} — autonomous AI maintainer for your codebase

Usage: mendai <command> [options]

Commands
  init            Create ${CONFIG_FILE}, a requirements/ folder and framework hooks
  scan            Show incomplete work, failing checks and pending requirements
  run             Scan and complete everything (requirements → failing checks → TODOs)
  fix             Only fix failing lint / type-check / tests
  todos           Only complete TODO / FIXME / unimplemented stubs
  requirements    Only implement pending items from requirements/*.md
  watch           Keep running whenever files change
  setup           Install/start Ollama and pull a free local model (no API key needed)
  doctor          Check providers, keys and detected commands
  install-skill   Install the mendai Agent Skill for Claude Code, Codex,
                  Antigravity, Gemini CLI (--agent claude,codex|all, --global)

Options
  --root <dir>            Project directory (default: cwd)
  --provider <name>       anthropic | openai | openrouter | groq | deepseek | ollama | custom
  --model <id>            Model id for the primary provider
  --effort <level>        low | medium | high | xhigh | max (Anthropic)
  --limit <n>             Max tasks this run
  --dry-run               List tasks without executing
  --no-checks             Skip running test/lint during scan
  --json                  Machine-readable scan output (for AI agents)
  --agent <list>          install-skill: ${Object.keys(SKILL_TARGETS).join(",")} or all
  --global                install-skill: user-wide instead of this project
  --commit                Git-commit after each completed task
  --yes                   Answer yes to setup prompts (install Ollama, download a model)
  --no-setup              Never try to set up a local model automatically
  --verbose               Debug logging
  --quiet                 Errors only
  -h, --help              Show this help
  -v, --version           Show version

Environment
  ANTHROPIC_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY, GROQ_API_KEY, DEEPSEEK_API_KEY
  MENDAI_PROVIDER, MENDAI_MODEL, MENDAI_MAX_TOKENS_PER_RUN, MENDAI_LOG_LEVEL
`;

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") args.flags.help = true;
    else if (a === "-v" || a === "--version") args.flags.version = true;
    else if (a.startsWith("--no-")) args.flags[a.slice(5)] = false;
    else if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        args.flags[key] = next;
        i++;
      } else args.flags[key] = true;
    } else args._.push(a);
  }
  return args;
}

function overridesFrom(flags) {
  const o = {};
  if (flags.provider) o.provider = flags.provider;
  if (flags.model) o.model = flags.model;
  if (flags.effort) o.effort = flags.effort;
  if (flags.verbose) o.logLevel = "debug";
  if (flags.quiet) o.logLevel = "error";
  if (flags.commit) o.git = { autoCommit: true };
  return o;
}

async function cmdInit(root, logger) {
  const framework = detectFramework(root);
  const { file, created } = writeDefaultConfig(root);
  logger[created ? "success" : "info"](`${created ? "Created" : "Exists"}: ${path.relative(root, file)}`);

  const reqDir = path.join(root, "requirements");
  if (!fs.existsSync(reqDir)) {
    fs.mkdirSync(reqDir, { recursive: true });
    fs.writeFileSync(
      path.join(reqDir, "example-module.md"),
      `# Example Module

One file per module. Each unchecked item is a task Mendai will implement,
then tick off. Add as much detail under an item as you like (indented lines).

## Features
- [x] This item is already done and will be skipped
- [ ] Add a \`GET /api/health\` endpoint that returns \`{ "status": "ok" }\`
    It should not require authentication.
    Add a test for it.
`,
    );
    logger.success("Created: requirements/example-module.md");
  }

  // Laravel hook: php artisan mendai:run
  if (framework.name === "laravel") {
    const dest = path.join(root, "app/Console/Commands/MendaiCommand.php");
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(here, "..", "stubs/laravel/MendaiCommand.php"), dest);
      logger.success("Created: app/Console/Commands/MendaiCommand.php  (php artisan mendai:run)");
    }
  }

  // .gitignore
  const gi = path.join(root, ".gitignore");
  const existing = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  if (!existing.includes(".mendai")) {
    fs.appendFileSync(gi, `${existing && !existing.endsWith("\n") ? "\n" : ""}# mendai state\n.mendai/\n`);
    logger.success("Added .mendai/ to .gitignore");
  }

  logger.info(`Detected: ${framework.label}`);
  logger.info(`Next: no key needed if Ollama is running locally; otherwise set ANTHROPIC_API_KEY or a free key (GEMINI_API_KEY / OPENROUTER_API_KEY / GROQ_API_KEY). Run "mendai doctor" to check.`);
}

async function cmdScan(root, flags, logger) {
  if (flags.json) {
    const quiet = createLogger({ level: "error" });
    const { framework, todos, requirements, issues } = scan({ root, config: overridesFrom(flags), logger: quiet, runChecks: flags.checks !== false });
    const out = {
      root,
      framework: { name: framework.name, label: framework.label, languages: framework.languages, commands: framework.commands },
      requirements: {
        modules: requirements.modules,
        tasks: requirements.tasks.map(({ spec, ...t }) => t),
      },
      issues,
      todos,
    };
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return;
  }
  const result = scan({ root, config: overridesFrom(flags), logger, runChecks: flags.checks !== false });
  const { framework, todos, requirements, issues } = result;
  logger.raw(`\nProject   ${root}\nFramework ${framework.label}\nCommands  ${Object.entries(framework.commands).map(([k, v]) => `${k}=${v}`).join("  ") || "(none)"}\n\n`);

  logger.raw(`Requirements (${requirements.tasks.length} pending)\n`);
  for (const m of requirements.modules) logger.raw(`  ${m.done}/${m.total}  ${m.name}  (${m.file})\n`);
  for (const t of requirements.tasks) logger.raw(`    [ ] ${t.text}\n`);

  logger.raw(`\nFailing checks (${issues.length})\n`);
  for (const i of issues) logger.raw(`  ✗ ${i.kind}: ${i.command}\n`);

  logger.raw(`\nTODOs / stubs (${todos.length})\n`);
  for (const t of todos.slice(0, 50)) logger.raw(`  ${t.file}:${t.line}  ${t.text.slice(0, 100)}\n`);
  if (todos.length > 50) logger.raw(`  … ${todos.length - 50} more\n`);
  logger.raw("\n");
}

async function cmdDoctor(root, flags, logger) {
  const config = loadConfig(root, overridesFrom(flags));
  const framework = detectFramework(root);
  logger.raw(`Framework: ${framework.label}\n`);
  logger.raw(`Allowed commands: ${allowedCommandPrefixes(framework, config).join(" | ")}\n\n`);

  let resolved;
  try {
    resolved = await resolveProviders(config, { logger });
  } catch (err) {
    logger.error(err.message);
    process.exitCode = 1;
    return;
  }
  const specs = [{ provider: resolved.provider, model: resolved.model }, ...resolved.fallbacks];
  for (const [i, spec] of specs.entries()) {
    const label = `${i === 0 ? "primary " : "fallback"} ${spec.provider}/${spec.model}`;
    const keyEnv = apiKeyEnvFor(spec.provider);
    if (keyEnv && !process.env[keyEnv]) {
      logger.warn(`${label}: ${keyEnv} not set`);
      continue;
    }
    try {
      const p = createProvider(spec, config);
      const res = await p.chat({ system: "Reply with the single word OK.", messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }], tools: [] });
      const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      logger.success(`${label}: reachable (${text.slice(0, 20) || "no text"}; served by ${res.servedBy})`);
    } catch (err) {
      logger.error(`${label}: ${err.message.split("\n")[0].slice(0, 200)}`);
    }
  }
}

async function main() {
  const { _: [command], flags } = parseArgs(process.argv.slice(2));
  if (flags.version) return console.log(pkg.version);
  if (flags.help || !command) return console.log(HELP);

  const root = path.resolve(flags.root ?? process.cwd());
  const logger = createLogger({ level: flags.verbose ? "debug" : flags.quiet ? "error" : "info" });
  const common = {
    root,
    config: overridesFrom(flags),
    logger,
    dryRun: Boolean(flags["dry-run"]),
    limit: flags.limit ? Number(flags.limit) : undefined,
    autoSetup: flags.setup !== false,
    confirm: flags.yes ? async () => true : undefined,
  };

  switch (command) {
    case "init":
      return cmdInit(root, logger);
    case "scan":
      return cmdScan(root, flags, logger);
    case "setup": {
      const ok = await ensureLocalModel({ logger, confirm: common.confirm });
      process.exitCode = ok ? 0 : 1;
      return ok ? logger.success("Local model ready. Run `mendai run`.") : logger.error("Setup incomplete. See SETUP.md.");
    }
    case "doctor":
      return cmdDoctor(root, flags, logger);
    case "install-skill": {
      const list = typeof flags.agent === "string" && flags.agent !== "all" ? flags.agent.split(",").map((a) => a.trim()).filter(Boolean) : undefined;
      try {
        for (const r of installSkill({ agents: list, scope: flags.global ? "global" : "project", root })) {
          logger.success(`${r.updated ? "Updated" : "Installed"} ${r.label}: ${r.dir}`);
        }
        logger.info('Restart your agent, then ask it to "use mendai to finish the TODOs / fix the tests / implement the requirements".');
      } catch (err) {
        logger.error(err.message);
        process.exitCode = 1;
      }
      return;
    }
    case "run":
      return run(common);
    case "fix":
      return run({ ...common, only: ["issues"] });
    case "todos":
      return run({ ...common, only: ["todos"] });
    case "requirements":
    case "req":
      return run({ ...common, only: ["requirements"] });
    case "watch":
      return watch(common);
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.stack ?? err.message ?? err);
  process.exitCode = 1;
});
