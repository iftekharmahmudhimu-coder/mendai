import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAICompatibleProvider, OPENAI_COMPATIBLE_PRESETS } from "./openai-compatible.js";
import { AllProvidersFailedError, BudgetExceededError, classifyError } from "./errors.js";

export { classifyError, AllProvidersFailedError, BudgetExceededError };

/**
 * Build one provider from a {provider, model, ...} spec.
 */
export function createProvider(spec, config = {}) {
  const provider = spec.provider ?? "anthropic";
  if (provider === "anthropic") {
    return createAnthropicProvider({
      model: spec.model,
      apiKey: spec.apiKey ?? process.env.ANTHROPIC_API_KEY,
      baseURL: spec.baseURL,
      effort: spec.effort ?? config.effort,
      serverFallback: spec.serverFallback ?? config.anthropic?.serverFallback ?? true,
    });
  }
  if (provider in OPENAI_COMPATIBLE_PRESETS) {
    return createOpenAICompatibleProvider({ ...spec, logger: config.logger });
  }
  if (typeof spec.chat === "function") return spec; // user-supplied custom provider object
  throw new Error(`Unknown provider "${provider}". Known: anthropic, ${Object.keys(OPENAI_COMPATIBLE_PRESETS).join(", ")}`);
}

/** Installed Ollama models, or null if no server answers. */
export async function listOllamaModels({ baseURL = "http://localhost:11434", fetchImpl = fetch, timeoutMs = 1500 } = {}) {
  try {
    const res = await fetchImpl(`${baseURL}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return ((await res.json()).models ?? []).map((m) => ({ name: m.name, size: m.size ?? 0 }));
  } catch {
    return null;
  }
}

export function pickOllamaModel(models) {
  if (!models?.length) return null;
  return (models.find((m) => /coder|code|deepseek|qwen/i.test(m.name)) ?? [...models].sort((a, b) => b.size - a.size)[0]).name;
}

export const FREE_SETUP_HELP = `No usable AI provider found. Pick any ONE free option:
  1. Local, no key, no account:  install https://ollama.com, then run  ollama pull qwen2.5-coder:7b
  2. Google Gemini free tier:    get a key at https://aistudio.google.com/apikey  ->  export GEMINI_API_KEY=...
  3. OpenRouter free models:     https://openrouter.ai/keys  ->  export OPENROUTER_API_KEY=...
  4. Groq free tier:             https://console.groq.com/keys  ->  export GROQ_API_KEY=...
  (Claude: export ANTHROPIC_API_KEY=...)`;

function keyEnvOf(spec) {
  if (spec.apiKey || typeof spec.chat === "function") return null;
  if ((spec.provider ?? "anthropic") === "anthropic") return "ANTHROPIC_API_KEY";
  return OPENAI_COMPATIBLE_PRESETS[spec.provider]?.keyEnv ?? null;
}

/**
 * Work out which providers can actually run: drop the ones with no API key,
 * and use a local Ollama server (no key needed) as a fallback or, when
 * nothing else is configured, as the primary. Returns a config copy with
 * provider/model/fallbacks adjusted and `notes` describing what was done.
 */
export async function resolveProviders(config, { env = process.env, fetchImpl = fetch, logger } = {}) {
  const wanted = [{ provider: config.provider, model: config.model, primary: true }, ...(config.fallbacks ?? [])];
  const usable = [];
  const notes = [];
  for (const spec of wanted) {
    const keyEnv = keyEnvOf(spec);
    if (keyEnv && !env[keyEnv]) {
      notes.push(`skipping ${spec.provider}/${spec.model}: ${keyEnv} not set`);
      continue;
    }
    usable.push(spec);
  }

  if (!usable.some((s) => s.provider === "ollama")) {
    const models = await listOllamaModels({ fetchImpl });
    const model = pickOllamaModel(models);
    if (model) {
      usable.push({ provider: "ollama", model });
      notes.push(`using local Ollama model ${model}${usable.length === 1 ? " (no API keys found)" : " as last-resort fallback"}`);
    }
  }

  if (!usable.length) {
    const err = new Error(FREE_SETUP_HELP);
    err.name = "NoProviderError";
    err.notes = notes;
    throw err;
  }

  for (const n of notes) logger?.info(n);
  const [first, ...rest] = usable;
  const primaryKept = first.primary === true;
  const { primary: _p, ...primary } = first;
  return {
    ...config,
    provider: primary.provider,
    model: primary.model,
    providerOptions: primaryKept ? config.providerOptions : undefined,
    fallbacks: rest,
    notes,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A chain of providers. The first one is used until it runs out of tokens,
 * credit, or rate limit (or exceeds the local budget); then the chain moves
 * on to the next and stays there for the rest of the run.
 */
export class ProviderChain {
  constructor(specs, { config = {}, logger, budget = 0 } = {}) {
    this.specs = specs;
    this.config = config;
    this.logger = logger;
    this.budget = budget; // max tokens for the primary provider (0 = unlimited)
    this.index = 0;
    this.providers = new Map();
    this.usage = { input: 0, output: 0, byProvider: {} };
    this.switches = [];
  }

  get current() {
    const spec = this.specs[this.index];
    if (!spec) return null;
    const key = `${spec.provider}/${spec.model}`;
    if (!this.providers.has(key)) {
      try {
        this.providers.set(key, createProvider(spec, this.config));
      } catch (err) {
        this.providers.set(key, { id: key, provider: spec.provider, model: spec.model, broken: err });
      }
    }
    return this.providers.get(key);
  }

  get isOnFallback() {
    return this.index > 0;
  }

  record(provider, usage) {
    this.usage.input += usage.input;
    this.usage.output += usage.output;
    const u = (this.usage.byProvider[provider.id] ??= { input: 0, output: 0, calls: 0 });
    u.input += usage.input;
    u.output += usage.output;
    u.calls += 1;
  }

  advance(reason) {
    const from = this.current;
    this.index += 1;
    const to = this.current;
    this.switches.push({ from: from?.id, to: to?.id, reason });
    if (to) this.logger?.warn(`Switching model: ${from?.id} -> ${to.id} (${reason})`);
    return to;
  }

  async chat(request) {
    const attempts = [];
    while (this.current) {
      const provider = this.current;

      if (provider.broken) {
        attempts.push({ provider: provider.provider, model: provider.model, error: provider.broken.message });
        this.advance(`unavailable: ${provider.broken.message}`);
        continue;
      }

      // Local budget only applies to the primary (paid) provider.
      if (this.index === 0 && this.budget > 0) {
        const used = this.usage.byProvider[provider.id];
        const total = (used?.input ?? 0) + (used?.output ?? 0);
        if (total >= this.budget) {
          const err = new BudgetExceededError(total, this.budget);
          attempts.push({ provider: provider.provider, model: provider.model, error: err.message });
          this.advance(err.message);
          continue;
        }
      }

      let transientRetries = 0;
      while (true) {
        try {
          const result = await provider.chat(request);
          this.record(provider, result.usage);
          result.provider = provider.id;
          return result;
        } catch (err) {
          const kind = classifyError(err);
          this.logger?.debug(`provider ${provider.id} error [${kind}]: ${err.message}`);
          if (kind === "transient" && transientRetries < 2) {
            transientRetries += 1;
            await sleep(1500 * transientRetries);
            continue;
          }
          if (kind === "quota" || kind === "auth" || kind === "unavailable" || kind === "transient" || kind === "context") {
            attempts.push({ provider: provider.provider, model: provider.model, error: err.message });
            if (!this.specs[this.index + 1]) throw new AllProvidersFailedError(attempts);
            this.advance(`${kind}: ${err.message.split("\n")[0].slice(0, 160)}`);
            break; // outer loop picks the next provider
          }
          throw err; // fatal: a genuine bug, surface immediately
        }
      }
    }
    throw new AllProvidersFailedError(attempts);
  }
}

/**
 * Build the provider chain from config: primary + fallbacks.
 */
export function createProviderChain(config, logger) {
  config = { ...config, logger };
  const specs = [
    { provider: config.provider, model: config.model, effort: config.effort, ...(config.providerOptions ?? {}) },
    ...(config.fallbacks ?? []),
  ];
  return new ProviderChain(specs, { config, logger, budget: config.budget?.maxTokensPerRun ?? 0 });
}
