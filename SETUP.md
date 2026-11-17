# Setup and serving guide

Mendai needs a language model. You can use a hosted one (needs a key) or a local one (needs no key and no account).

## 1. Fastest: let mendai set it up

```bash
npx mendai setup        # asks before each step
npx mendai setup --yes  # answers yes to everything
```

`setup` does only what is missing, in this order:

1. **Installs Ollama** if it is not installed. This is Linux only. It runs the official script from ollama.com and needs sudo. On macOS and Windows it prints the download link instead.
2. **Starts the Ollama server** (`ollama serve`) if nothing is listening on `localhost:11434`.
3. **Downloads a model** if none is installed. The default is `qwen2.5-coder:7b`, about 4.7 GB.

`mendai run` does the same automatically when it finds no usable provider. It asks first, or you can pass `--yes`. Use `--no-setup` to turn this off, for example in CI.

## 2. Manual setup (same result)

```bash
curl -fsSL https://ollama.com/install.sh | sh   # install (Linux). macOS: brew install ollama
ollama serve                                    # start the server (leave it running)
ollama pull qwen2.5-coder:7b                    # download a model
npx mendai doctor                           # confirm it is reachable
```

If you already have a model, mendai uses it. It prefers coder models and otherwise takes the largest one installed. To force one: `mendai run --provider ollama --model <name>`.

## 3. Hosted free tiers (no install)

| Provider | Get a key | Variable |
|---|---|---|
| Google Gemini | https://aistudio.google.com/apikey | `GEMINI_API_KEY` |
| OpenRouter (free models) | https://openrouter.ai/keys | `OPENROUTER_API_KEY` |
| Groq | https://console.groq.com/keys | `GROQ_API_KEY` |
| Claude | https://console.anthropic.com | `ANTHROPIC_API_KEY` |

Set any one: `export GEMINI_API_KEY=...`. Providers without a key are skipped automatically. Keys are tried in this order: Claude, Gemini, OpenRouter, Groq, then local Ollama as the last resort.

## 4. Running it

```bash
npx mendai init            # config file, requirements/ folder, framework hooks
npx mendai scan            # list work found (needs no model)
npx mendai run --dry-run   # show the tasks it would do (needs no model)
npx mendai run             # do the work
npx mendai run --commit    # commit after each completed task
npx mendai watch           # keep running whenever files change
```

After each task mendai re-runs your tests, lint and type-check. If they fail, it undoes that task's changes. Add `--limit 3` to try it on a few tasks first.

## 5. Keeping it running (serving)

**Ollama as a service (Linux).** The install script already sets up a systemd service:

```bash
sudo systemctl enable --now ollama
systemctl status ollama
```

**Mendai in watch mode** in a terminal or tmux session:

```bash
cd /path/to/project && npx mendai watch --commit
```

**Mendai as a systemd service:**

```ini
# /etc/systemd/system/mendai.service
[Unit]
Description=Mendai watcher
After=network.target ollama.service

[Service]
WorkingDirectory=/path/to/project
Environment=GEMINI_API_KEY=your-key-if-using-hosted
ExecStart=/usr/bin/npx mendai watch --no-setup --commit
Restart=on-failure
User=youruser

[Install]
WantedBy=multi-user.target
```

**Laravel:** `npx mendai init` adds `php artisan mendai:run`.

**From code:**

```js
import { run } from "mendai";
await run({ root: process.cwd(), autoSetup: true });
```

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| "No usable AI provider found" | Run `mendai setup`, or set one key from section 3. |
| Ollama is slow or times out | The model may not fit in memory. Try a smaller one, e.g. `ollama pull qwen2.5-coder:3b`. |
| Many tasks fail on a local model | Small models are weaker at multi-step edits. Use a hosted key, or run `--limit` with simpler tasks. |
| Port 11434 in use | Ollama is already running. Skip `ollama serve`. |
| Stops with "No usable AI provider" in CI | CI has no terminal to answer prompts. Set a key from section 3 as a CI secret, and pass `--no-setup`. |
