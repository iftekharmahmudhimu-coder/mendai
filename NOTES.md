# mendai — Project Notes

Last updated: 2026-11-05

Two parts:

1. **For you (the maintainer):** where the project stands today and what to do next, in order, to get it from "works on my machine" to "anyone can `npm install` it".
2. **For users / integrators:** how to install mendai into any project and use it.

---

## Part 1 — Current status and what to do next

### Where things stand right now

| Check | Status |
|---|---|
| Tests (`npm test`) | 13/13 pass |
| Lint (`npm run lint`) | passes |
| Tarball (`npm pack --dry-run`) | 17 files, ~29 kB, only `bin/`, `src/`, `stubs/`, `README.md`, `package.json` |
| Package name `mendai` on npm | **free** (registry returns 404) |
| Git repository | **not initialised** |
| npm login | **not logged in** (`npm whoami` fails) |
| `LICENSE` file | **missing** (package.json says MIT) |
| `repository` / `author` / `bugs` / `homepage` in package.json | **missing** |
| CHANGELOG | missing |
| CI (GitHub Actions) | missing |

Nothing is blocking a publish except the steps below.

### Step-by-step: first to last

#### Step 1 — Put it in git

```bash
cd /home/himu/Sites/codemender-ai
git init
git add .
git commit -m "Initial release of mendai 0.1.0"
```

`.gitignore` already excludes `node_modules/` and `.mendai/`.

#### Step 2 — Add the missing metadata files

Create `LICENSE` (MIT, your name, 2026). npm includes `LICENSE` automatically even though it is not in the `files` list.

Add to `package.json` (replace the placeholders):

```json
"author": "Your Name <you@example.com>",
"repository": { "type": "git", "url": "git+https://github.com/<you>/mendai.git" },
"homepage": "https://github.com/<you>/mendai#readme",
"bugs": { "url": "https://github.com/<you>/mendai/issues" },
"publishConfig": { "access": "public" }
```

Also add a safety script so a publish never goes out with failing tests:

```json
"scripts": {
  "test": "node --test test/*.test.js",
  "lint": "...",
  "prepublishOnly": "npm run lint && npm test"
}
```

#### Step 3 — Create the GitHub repo and push

```bash
gh repo create mendai --public --source=. --remote=origin --push
# or create it in the browser, then:
git remote add origin git@github.com:<you>/mendai.git
git push -u origin main
```

#### Step 4 — Test the package in a real project before publishing

Do this once in a Node project and once in a Laravel project.

```bash
# Option A: symlink (fast iteration)
cd /home/himu/Sites/codemender-ai && npm link
cd /path/to/some-project && npm link mendai
npx mendai init && npx mendai doctor && npx mendai scan

# Option B: install the exact tarball a user would get
cd /home/himu/Sites/codemender-ai && npm pack          # -> mendai-0.1.0.tgz
cd /path/to/some-project && npm i -D /home/himu/Sites/codemender-ai/mendai-0.1.0.tgz
npx mendai scan --dry-run
```

Things worth checking during this test:

- `mendai init` in a Laravel app creates `app/Console/Commands/MendaiCommand.php` and `php artisan mendai:run scan` works.
- `mendai doctor` reports the primary provider reachable with a real `ANTHROPIC_API_KEY`.
- Forcing a fallback works: set `MENDAI_MAX_TOKENS_PER_RUN=1000` and watch it switch to OpenRouter/Ollama.
- `mendai run --dry-run` lists tasks without touching files.
- `mendai run --limit 1 --commit` on a throwaway branch produces one reviewable commit.

#### Step 5 — Log in to npm and publish

```bash
npm login                      # opens the browser, one time
npm publish                    # runs prepublishOnly (lint + test) first
```

Verify:

```bash
npm view mendai
npx mendai@latest --version      # from any directory
```

#### Step 6 — Tag the release

```bash
git tag v0.1.0
git push --tags
gh release create v0.1.0 --title "v0.1.0" --notes "First public release"
```

#### Step 7 — Add CI (recommended, not required)

`.github/workflows/ci.yml`:

```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ matrix.node }} }
      - run: npm ci
      - run: npm run lint
      - run: npm test
```

#### Step 8 — Releasing future versions

```bash
# make changes, update CHANGELOG.md
npm version patch        # or minor / major — bumps package.json and creates a git tag
git push && git push --tags
npm publish
```

Semantic versioning rule of thumb: bug fix → patch, new command/flag/provider → minor, breaking config change → major.

### Nice-to-have backlog (after 0.1.0 is out)

- `CHANGELOG.md` (Keep a Changelog format).
- An `examples/laravel/` folder mirroring `examples/express-server.js`.
- Add `index.d.ts` so TypeScript users get types for `createAgent` and friends.
- A `--yes` / non-interactive flag note for CI usage in the README.
- Screenshots or a short GIF of `mendai scan` / `run` output in the README.
- A "Troubleshooting" section in the README (missing key, Ollama not running, model name typo, 402 from Anthropic).
- GitHub issue templates and a `CONTRIBUTING.md`.
- Consider a `mendai` npm name alias later; for now the bin is already `mendai` even though the package is `mendai`.

---

## Part 2 — How anyone can install and use mendai

### Requirements

- Node.js 20 or newer (the agent itself runs on Node; your project can be PHP, Go, Python, anything).
- At least one model provider:
  - `ANTHROPIC_API_KEY` for Claude (recommended primary), and/or
  - `OPENROUTER_API_KEY` for the free fallback models, and/or
  - a local [Ollama](https://ollama.com) install with a coding model (`ollama pull qwen2.5-coder:7b`) for a fully offline setup.

### 1. Install

Pick one:

```bash
# A) Inside a project, as a dev dependency (recommended)
npm install --save-dev mendai

# B) Globally, available in every project
npm install -g mendai

# C) No install at all
npx mendai --help

# D) Before it is on npm, straight from GitHub
npm install --save-dev github:<you>/mendai

# E) From a tarball someone sent you
npm install --save-dev ./mendai-0.1.0.tgz
```

After A or B the command is `mendai` (use `npx mendai` inside a project).

### 2. Set your API keys

```bash
export ANTHROPIC_API_KEY=sk-ant-...     # primary model
export OPENROUTER_API_KEY=sk-or-...     # optional free fallback
# or no keys at all and use Ollama locally (see "Offline" below)
```

Put these in your shell profile, a `.env` loaded by your shell, or your CI secrets. mendai reads them from the environment only; it never stores keys.

### 3. Initialise the project

```bash
cd /path/to/your-project
npx mendai init
```

This creates:

- `mendai.config.json` — provider, model, fallbacks, budget, allowed commands.
- `requirements/example-module.md` — a sample requirements file.
- `app/Console/Commands/MendaiCommand.php` — only in Laravel projects, gives you `php artisan mendai:run`.
- `.mendai/` added to `.gitignore` — run state lives there.

### 4. Check everything is wired up

```bash
npx mendai doctor
```

Shows the detected framework, the commands the agent is allowed to run, and pings every configured provider (primary + fallbacks) so you know which ones are reachable.

### 5. See what it would do

```bash
npx mendai scan
```

Lists pending requirement items, failing lint/test/type-check commands, and TODO/FIXME/stub comments. Nothing is changed.

### 6. Let it work

```bash
git checkout -b mendai/auto      # always on a branch

npx mendai run                   # requirements -> failing checks -> TODOs
npx mendai run --dry-run         # list the tasks, do nothing
npx mendai run --limit 3         # only three tasks this time
npx mendai run --commit          # one git commit per completed task
npx mendai fix                   # only make failing checks pass
npx mendai todos                 # only finish TODO / FIXME / stubs
npx mendai requirements          # only implement requirements/*.md
npx mendai watch                 # keep running whenever files change
```

Then review the diff / commits like any other pull request.

### 7. Describe features with requirements files

One markdown file per module in `requirements/`. Every unchecked box is a task; indented lines under it are details for the agent.

```markdown
# Orders

## Data
- [ ] `orders` table: id, user_id (FK), status (enum), total (decimal), timestamps
- [ ] Order model with `user()` relation and `scopePaid()`

## API
- [ ] POST /api/orders — create an order for the authenticated user
    Validate items[] required, each with product_id and qty >= 1
    Return 201 with the order resource
- [x] GET /api/orders — already done
```

When an item is implemented and the project's checks pass, mendai flips `[ ]` to `[x]`.

### 8. Choose or switch models

Edit `mendai.config.json`:

```json
{
  "provider": "anthropic",
  "model": "claude-opus-5-5",
  "effort": "high",
  "fallbacks": [
    { "provider": "openrouter", "model": "meta-llama/llama-3.3-70b-instruct:free" },
    { "provider": "ollama", "model": "qwen2.5-coder:7b" }
  ],
  "budget": { "maxTokensPerRun": 2000000 }
}
```

Or override per run: `npx mendai run --provider ollama --model qwen2.5-coder:7b`.

Supported providers: `anthropic`, `openai`, `openrouter`, `groq`, `deepseek`, `ollama`, `custom` (any OpenAI-compatible endpoint via `baseURL`). When the primary hits a rate limit, runs out of credit, is overloaded, or passes your token budget, it moves to the next fallback automatically and logs the switch.

### Offline / free-only setup

```bash
ollama pull qwen2.5-coder:7b
npx mendai run --provider ollama --model qwen2.5-coder:7b
```

Or set `"provider": "ollama"` in the config. No API key required.

### Laravel

After `npx mendai init` inside the Laravel app:

```bash
php artisan mendai:run              # same as npx mendai run
php artisan mendai:run scan
php artisan mendai:run fix --limit=3 --commit
```

Schedule it in `routes/console.php`:

```php
Schedule::command('mendai:run')->hourly()->withoutOverlapping();
```

The Laravel command shells out to `npx mendai`, so Node 20+ and the npm package must be present on that machine. Allow extra artisan commands with `allowedCommands` in the config.

### Node / programmatic use

```js
import { createAgent } from "mendai";

const agent = createAgent({ root: process.cwd(), config: { model: "claude-opus-5-5" } });

await agent.run();                         // everything
await agent.fix();                         // failing checks only
await agent.implementRequirements();       // requirements only
agent.watch();                             // on file changes
const stop = agent.schedule(30 * 60_000);  // every 30 min inside a server; call stop() to end
```

See `examples/express-server.js` for a full server example. Lower-level exports: `scan`, `runTask`, `detectFramework`, `createProviderChain`, `scanRequirements`, `markRequirementDone`.

### Running it in CI or on a schedule (any framework)

GitHub Actions example that opens a PR with whatever mendai completed:

```yaml
name: mendai
on:
  schedule: [{ cron: "0 3 * * *" }]
  workflow_dispatch:
jobs:
  mend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx mendai run --limit 5 --commit
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
      - uses: peter-evans/create-pull-request@v6
        with:
          branch: mendai/auto
          title: "mendai: automated fixes"
```

Plain cron on a server:

```
0 3 * * * cd /srv/app && ANTHROPIC_API_KEY=... npx mendai run --limit 5 --commit >> /var/log/mendai.log 2>&1
```

### Safety notes for users

- Run on a branch, review every diff.
- The agent can only touch files under the project root and only run allow-listed commands (detected test/lint/build, framework scaffolding, git, plus your `allowedCommands`).
- Set `"git": { "requireCleanTree": true }` to refuse running on uncommitted changes.
- Set `budget.maxTokensPerRun` to cap spend on the paid primary model.
- Tasks that fail three times are skipped; see `.mendai/state.json`.

### Troubleshooting

| Symptom | Fix |
|---|---|
| `ANTHROPIC_API_KEY not set` in `doctor` | export the key in the same shell / CI job |
| 402 or "credit balance is too low" | add credit, or let the fallback chain take over (needs `OPENROUTER_API_KEY` or Ollama) |
| Ollama fallback fails | `ollama serve` must be running and the model pulled |
| "Unknown command" | run `npx mendai --help`; commands are `init scan run fix todos requirements watch doctor` |
| Agent refuses a command | add its prefix to `allowedCommands` in `mendai.config.json` |
| Nothing found by `scan` | add a `requirements/*.md` file with `- [ ]` items, or make sure your test/lint scripts are detectable (`package.json` scripts, `phpunit.xml`, etc.) |

### Uninstall

```bash
npm uninstall mendai          # or: npm uninstall -g mendai
rm -rf .mendai mendai.config.json requirements   # optional
rm app/Console/Commands/MendaiCommand.php             # Laravel only
```
