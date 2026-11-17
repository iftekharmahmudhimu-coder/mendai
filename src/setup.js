import readline from "node:readline/promises";
import { spawn, spawnSync } from "node:child_process";
import { listOllamaModels } from "./providers/index.js";

export const DEFAULT_LOCAL_MODEL = "qwen2.5-coder:7b";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ask a yes/no question on the terminal. Non-interactive sessions answer "no". */
export async function askYesNo(question) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

const real = {
  platform: process.platform,
  hasOllama: () => spawnSync("ollama", ["--version"], { stdio: "ignore" }).status === 0,
  install: () => spawnSync("sh", ["-c", "curl -fsSL https://ollama.com/install.sh | sh"], { stdio: "inherit" }).status === 0,
  startServer: () => spawn("ollama", ["serve"], { detached: true, stdio: "ignore" }).unref(),
  listModels: () => listOllamaModels(),
  pull: (model) => spawnSync("ollama", ["pull", model], { stdio: "inherit" }).status === 0,
};

/**
 * Make a local model available: install Ollama if missing, start its server
 * if it isn't running, and pull a model if none is installed. Every step that
 * changes the machine asks `confirm` first. Returns true when a model is ready.
 */
export async function ensureLocalModel({ logger, confirm = askYesNo, model = DEFAULT_LOCAL_MODEL, deps = {}, waitMs = 30_000 } = {}) {
  const d = { ...real, ...deps };

  if (!d.hasOllama()) {
    if (d.platform !== "linux") {
      logger?.error("Ollama is not installed. Download it from https://ollama.com/download, then run mendai again.");
      return false;
    }
    if (!(await confirm("Ollama (local AI runtime) is not installed. Install it now with the official script from ollama.com (needs sudo)?"))) return false;
    logger?.info("Installing Ollama…");
    if (!d.install() || !d.hasOllama()) {
      logger?.error("Ollama install failed. Install it manually from https://ollama.com/download.");
      return false;
    }
  }

  let models = await d.listModels();
  if (models === null) {
    logger?.info("Starting the Ollama server (ollama serve)…");
    d.startServer();
    for (let waited = 0; models === null && waited < waitMs; waited += 500) {
      await sleep(waited === 0 && deps.listModels ? 0 : 500);
      models = await d.listModels();
    }
    if (models === null) {
      logger?.error("Ollama server did not start. Try running `ollama serve` in another terminal.");
      return false;
    }
  }

  if (!models.length) {
    if (!(await confirm(`No local model is installed. Download ${model} (about 4.7 GB)?`))) return false;
    logger?.info(`Pulling ${model}…`);
    if (!d.pull(model)) {
      logger?.error(`Could not pull ${model}.`);
      return false;
    }
  }
  return true;
}
