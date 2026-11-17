# mendai CLI reference

Install: `npm i -D mendai`, or run it directly with `npx -y mendai <command>`. Requires Node 20+.

| Command | What it does | Needs a model? |
|---|---|---|
| `scan [--json] [--no-checks]` | List pending requirements, failing checks and TODOs/stubs | No |
| `init` | Create `mendai.config.json`, `requirements/`, Laravel `php artisan mendai:run` | No |
| `doctor` | Show the detected framework and allowed commands; ping each provider | Yes (to ping) |
| `run` | Requirements, then failing checks, then TODOs, with its own agent loop | Yes |
| `fix` / `todos` / `requirements` | Run one category only | Yes |
| `watch` | Re-run whenever files change | Yes |
| `setup [--yes]` | Install/start Ollama and pull a free local coder model (Linux) | No |
| `install-skill` | Install this skill into Claude Code / Codex / Antigravity / Gemini CLI | No |

Flags: `--root <dir>`, `--dry-run`, `--limit <n>`, `--commit` (one git commit per task), `--provider <name> --model <id>`, `--effort low|medium|high|xhigh|max`, `--yes`, `--no-setup`, `--verbose`, `--quiet`.

## Providers (own-model mode)

`anthropic` (default, `claude-opus-5-5`), `openai`, `openrouter`, `groq`, `deepseek`, `gemini`, `ollama`, `custom` (any OpenAI-compatible endpoint). Keys: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `MENDAI_CUSTOM_API_KEY`. Ollama needs no key.

When the primary model hits a rate limit, runs out of credit, fails authentication or exceeds `budget.maxTokensPerRun`, the chain switches to the next fallback and stays on it.

## Safety rails in own-model mode

- File tools are confined to the project root; `.git` is never touched directly.
- `run_command` accepts only an allow-list: detected test/lint/build commands, framework scaffolding, git, and `allowedCommands` from the config. Shell operators are rejected.
- After each task the checks are re-run. A task that breaks them is reverted.
- Tasks that fail three times are skipped on later runs (`.mendai/state.json`).

## Config (`mendai.config.json`)

```json
{
  "provider": "anthropic",
  "model": "claude-opus-5-5",
  "fallbacks": [{ "provider": "ollama", "model": "qwen2.5-coder:7b" }],
  "budget": { "maxTokensPerRun": 2000000 },
  "requirementsDir": "requirements",
  "tasks": { "todos": true, "issues": true, "requirements": true },
  "allowedCommands": [],
  "maxIterations": 60
}
```
