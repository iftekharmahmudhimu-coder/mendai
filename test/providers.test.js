import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { ProviderChain, classifyError } from "../src/providers/index.js";
import { fakeProvider, silentLogger } from "./helpers.js";

function chainOf(providers, budget = 0) {
  const chain = new ProviderChain(providers.map((p) => ({ provider: p.provider, model: p.model })), { logger: silentLogger, budget });
  for (const p of providers) chain.providers.set(p.id, p);
  return chain;
}

const req = { system: "", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], tools: [] };

test("classifies Anthropic errors", () => {
  const mk = (Cls, status, msg, body) => new Cls(status, body ?? { type: "error", error: { type: "x", message: msg } }, msg, new Headers());
  assert.equal(classifyError(mk(Anthropic.RateLimitError, 429, "rate")), "quota");
  assert.equal(classifyError(mk(Anthropic.AuthenticationError, 401, "bad key")), "auth");
  assert.equal(classifyError(mk(Anthropic.BadRequestError, 400, "Your credit balance is too low")), "quota");
  assert.equal(classifyError(mk(Anthropic.BadRequestError, 400, "messages: invalid")), "fatal");
  assert.equal(classifyError(Object.assign(new Error("x"), { status: 429 })), "quota");
  assert.equal(classifyError(Object.assign(new Error("x"), { status: 503 })), "transient");
  assert.equal(classifyError(Object.assign(new Error("x"), { code: "ECONNREFUSED" })), "transient");
});

test("falls back to the next provider on quota errors and stays there", async () => {
  const quota = Object.assign(new Error("429 rate limited"), { status: 429 });
  const primary = fakeProvider("anthropic/claude-opus-5-5", [], { failWith: quota });
  const free = fakeProvider("openrouter/free-model", [[{ type: "text", text: "one" }], [{ type: "text", text: "two" }]]);
  const chain = chainOf([primary, free]);

  const r1 = await chain.chat(req);
  assert.equal(r1.provider, "openrouter/free-model");
  assert.equal(chain.isOnFallback, true);
  const r2 = await chain.chat(req);
  assert.equal(r2.provider, "openrouter/free-model");
  assert.equal(primary.calls, 1, "primary is not retried after switching");
  assert.equal(chain.switches.length, 1);
  assert.match(chain.switches[0].reason, /quota/);
});

test("switches when the local token budget is exhausted", async () => {
  const primary = fakeProvider("anthropic/claude-opus-5-5", [[{ type: "text", text: "a" }], [{ type: "text", text: "b" }]]);
  const free = fakeProvider("ollama/qwen", [[{ type: "text", text: "c" }]]);
  const chain = chainOf([primary, free], 20); // each fake call uses 15 tokens

  assert.equal((await chain.chat(req)).provider, "anthropic/claude-opus-5-5");
  assert.equal((await chain.chat(req)).provider, "anthropic/claude-opus-5-5"); // 30 > 20 now
  assert.equal((await chain.chat(req)).provider, "ollama/qwen");
  assert.match(chain.switches[0].reason, /budget/i);
});

test("surfaces fatal errors without switching", async () => {
  const bad = Object.assign(new Error("400 bad schema"), { status: 400 });
  const primary = fakeProvider("anthropic/x", [], { failWith: bad });
  const free = fakeProvider("ollama/y", [[{ type: "text", text: "c" }]]);
  const chain = chainOf([primary, free]);
  await assert.rejects(() => chain.chat(req), /bad schema/);
  assert.equal(free.calls, 0);
});

test("throws AllProvidersFailedError when every provider is out", async () => {
  const quota = Object.assign(new Error("out"), { status: 402 });
  const chain = chainOf([fakeProvider("a/b", [], { failWith: quota }), fakeProvider("c/d", [], { failWith: quota })]);
  await assert.rejects(() => chain.chat(req), (e) => e.name === "AllProvidersFailedError" && e.attempts.length === 2);
});

test("a 404 (model not found) moves to the next provider", async () => {
  const missing = Object.assign(new Error("model 'x' not found"), { status: 404 });
  assert.equal(classifyError(missing), "unavailable");
  const chain = chainOf([fakeProvider("ollama/x", [], { failWith: missing }), fakeProvider("ollama/y", [[{ type: "text", text: "ok" }]])]);
  assert.equal((await chain.chat(req)).provider, "ollama/y");
});

import { resolveProviders, pickOllamaModel } from "../src/providers/index.js";

const fakeFetch = (models) => async () => (models ? { ok: true, json: async () => ({ models }) } : Promise.reject(new Error("ECONNREFUSED")));
const base = { provider: "anthropic", model: "m", effort: "high", providerOptions: { x: 1 }, fallbacks: [{ provider: "openrouter", model: "f:free" }] };

test("resolveProviders: no keys + Ollama running -> Ollama becomes primary", async () => {
  const r = await resolveProviders(base, { env: {}, fetchImpl: fakeFetch([{ name: "gemma:e4b", size: 5 }]) });
  assert.equal(r.provider, "ollama");
  assert.equal(r.model, "gemma:e4b");
  assert.deepEqual(r.fallbacks, []);
  assert.equal(r.providerOptions, undefined);
});

test("resolveProviders: keyed providers are kept, Ollama appended as last resort", async () => {
  const r = await resolveProviders(base, { env: { ANTHROPIC_API_KEY: "k", OPENROUTER_API_KEY: "k" }, fetchImpl: fakeFetch([{ name: "qwen2.5-coder:7b", size: 1 }]) });
  assert.equal(r.provider, "anthropic");
  assert.deepEqual(r.providerOptions, { x: 1 });
  assert.deepEqual(r.fallbacks.map((f) => f.provider), ["openrouter", "ollama"]);
});

test("resolveProviders: missing primary key promotes the first keyed fallback", async () => {
  const r = await resolveProviders(base, { env: { OPENROUTER_API_KEY: "k" }, fetchImpl: fakeFetch(null) });
  assert.equal(r.provider, "openrouter");
  assert.equal(r.model, "f:free");
});

test("resolveProviders: nothing usable throws a helpful error", async () => {
  await assert.rejects(resolveProviders(base, { env: {}, fetchImpl: fakeFetch(null) }), (e) => e.name === "NoProviderError" && /ollama pull/.test(e.message) && /GEMINI_API_KEY/.test(e.message));
});

test("pickOllamaModel prefers coder models, else the largest", () => {
  assert.equal(pickOllamaModel([{ name: "a", size: 9 }, { name: "qwen2.5-coder", size: 1 }]), "qwen2.5-coder");
  assert.equal(pickOllamaModel([{ name: "a", size: 1 }, { name: "b", size: 9 }]), "b");
  assert.equal(pickOllamaModel([]), null);
});

import { ensureLocalModel } from "../src/setup.js";

function fakeDeps(over = {}) {
  const calls = [];
  let installed = over.installed ?? false;
  let models = over.models ?? null; // null = server down
  return {
    calls,
    deps: {
      platform: over.platform ?? "linux",
      hasOllama: () => installed,
      install: () => (calls.push("install"), (installed = over.installOk ?? true)),
      startServer: () => (calls.push("serve"), (models = models ?? [])),
      listModels: async () => models,
      pull: (m) => (calls.push(`pull ${m}`), (models = [{ name: m, size: 1 }]), true),
    },
  };
}

test("ensureLocalModel installs, starts the server and pulls a model when confirmed", async () => {
  const f = fakeDeps();
  const ok = await ensureLocalModel({ confirm: async () => true, deps: f.deps, model: "m:1" });
  assert.equal(ok, true);
  assert.deepEqual(f.calls, ["install", "serve", "pull m:1"]);
});

test("ensureLocalModel changes nothing when the user declines", async () => {
  const f = fakeDeps();
  assert.equal(await ensureLocalModel({ confirm: async () => false, deps: f.deps }), false);
  assert.deepEqual(f.calls, []);
});

test("ensureLocalModel does nothing when a model is already ready", async () => {
  const f = fakeDeps({ installed: true, models: [{ name: "x", size: 1 }] });
  assert.equal(await ensureLocalModel({ confirm: async () => assert.fail("should not ask"), deps: f.deps }), true);
  assert.deepEqual(f.calls, []);
});

test("ensureLocalModel never auto-installs on non-Linux", async () => {
  const f = fakeDeps({ platform: "darwin" });
  assert.equal(await ensureLocalModel({ confirm: async () => true, deps: f.deps }), false);
  assert.deepEqual(f.calls, []);
});
