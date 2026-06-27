# AgriTech Startup Discovery Tracker

Automated discovery of agrifood and agtech startups from news sources. The tracker crawls configured sites, extracts startup names and news summaries with **Ollama**, and stores results in **Excel** and **PostgreSQL**.

**Standalone project** — no private npm registry or external platform dependencies. All code lives in this repository.

## What it does

1. **Crawl** — fetches listing pages from news sources (HTTP or headed browser for login-gated feeds)
2. **Detect changes** — skips unchanged sections and duplicate articles via content hashing
3. **Extract** — sends article text to a local Ollama model for structured startup data
4. **Persist** — upserts startup rows into Postgres (`agritech.news`) and mirrors the same data in `./data/agritech-news.xlsx`; append-only crawl events go to `agritech.logs` and `./data/agritech-logs.xlsx`
5. **Schedule** — runs all enabled source jobs on a configurable interval, with a **delay between jobs** so they do not overlap

### Current sources

| Source | Site | Fetch mode |
|---|---|---|
| **Inc42** | [inc42.com/industry/agritech](https://inc42.com/industry/agritech/) | Browser (Datalabs feed — login required) |
| **AgFunder** | [agfundernews.com](https://agfundernews.com) | HTTP |

Each source is an independent **job** wired into a single **orchestrator**. New sources can be added without changing existing ones (see [ARCHITECTURE.md](./ARCHITECTURE.md)).

---

## Prerequisites

| Requirement | Used for |
|---|---|
| **Node.js 18+** | App runtime |
| **[Ollama](https://ollama.com/)** + `llama3.2` (or similar JSON model) | Startup extraction |
| **PostgreSQL 16** | `agritech.news` + `agritech.logs` |
| **Google Chrome** (Mac) | Inc42 login + browser crawl |
| **Docker + Docker Compose** (optional) | Postgres + AgFunder-only container runs |

---

## Step-by-step: run locally (recommended for full demo)

Use this path when you need **both Inc42 (browser) and AgFunder**. Inc42 must run on your Mac — it does not work inside the Docker app container.

### 1. Clone and install

```bash
cd Agritech_News_Agent
cp .env.example .env
npm install
npm run build
```

### 2. Start PostgreSQL

**Option A — Docker Postgres only (app runs on host):**

```bash
docker compose up -d postgres
```

Keep `DB_HOST=localhost` in `.env`.

**Option B — Local Postgres:** create database `agritech` and match `DB_*` in `.env`.

### 3. Run database migrations

Applies `001` (schema + news table) and `002` (logs table):

```bash
npm run db:migrate
```

Verify:

```bash
psql -h localhost -p 5432 -U postgres -d agritech -c '\dt agritech.*'
```

### 4. Start Ollama

```bash
ollama serve          # separate terminal
ollama pull llama3.2
```

### 5. Log in to Inc42 (one-time, or when session expires)

Inc42’s agritech Datalabs feed requires Google OAuth. We sign in through **real Chrome**, then export the session for automated crawls.

```bash
npm run inc42:login
```

Follow the prompts:

1. Chrome opens the Inc42 agritech feed.
2. Sign in with Google when prompted.
3. **Close any extra tabs** (e.g. Gemini) and stay on the Inc42 feed until listings appear.
4. Press **Enter** in the terminal — the script focuses the Inc42 tab and saves `profiles/inc42/inc42-auth.json` (no new tabs opened).
5. Quit Chrome completely (**Cmd+Q**).

The script validates `wordpress_logged_in` and `inc42.com` cookies before saving. A bad save is deleted automatically.

### 6. Start the tracker

```bash
npm run dev
```

For a single cycle (all enabled jobs, then exit):

```bash
npm run dev:once
```

On startup you should see Inc42 run first. After **2 minutes** (`JOB_STAGGER_DELAY_MS=120000`), AgFunder starts.

---

## Step-by-step: run with Docker

Docker runs **Postgres + the app container**. AgFunder works in Docker. **Inc42 browser crawl does not** — use the local path above for Inc42.

### 1. Prepare environment

```bash
cp .env.docker.example .env
```

Defaults: AgFunder enabled, Inc42 disabled, Excel + Postgres enabled.

### 2. Start Ollama on the host

```bash
ollama serve
ollama pull llama3.2
```

The container reaches Ollama via `http://host.docker.internal:11434`.

### 3. Build and start

```bash
docker compose up --build -d
docker compose logs -f agritech-tracker
```

Postgres init runs `001_agritech_schema.sql` on first boot. For the **logs** table (`002`), run migrations from the host:

```bash
npm run db:migrate
```

### 4. Single cycle

```bash
docker compose run --rm -e AGRITECH_RUN_ONCE=true agritech-tracker
```

### 5. Hybrid setup (Inc42 local + AgFunder Docker)

Run Postgres and AgFunder in Docker, Inc42 on the host:

```env
# .env on host
AGRITECH_INC42_ENABLED=true
AGRITECH_INC42_BROWSER_ENABLED=true
AGRITECH_AGFUNDER_ENABLED=false   # let Docker handle AgFunder
DB_HOST=localhost
```

```bash
docker compose up -d postgres agritech-tracker   # AgFunder only in container
npm run inc42:login                              # once
npm run dev                                      # Inc42 on host
```

---

## How jobs run

The **orchestrator** (`src/dependencies.ts`) owns one scheduler. It does **not** give each source its own timer.

```
Every AGRITECH_DEFAULT_INTERVAL_MS (default 7 days):
  1. Run Inc42 job (if enabled)
  2. Wait JOB_STAGGER_DELAY_MS (default 2 minutes)
  3. Run AgFunder job (if enabled)
  4. Wait until next cycle
```

| Variable | Default | Meaning |
|---|---|---|
| `AGRITECH_DEFAULT_INTERVAL_MS` | `604800000` (7 days) | Time between orchestrator cycles |
| `JOB_STAGGER_DELAY_MS` | `120000` (2 min) | Pause between jobs in one cycle |
| `AGRITECH_RUN_ONCE` | `false` | Run one cycle and exit |

Per-source toggles:

| Variable | Default | Source |
|---|---|---|
| `AGRITECH_INC42_ENABLED` | `true` | Inc42 |
| `AGRITECH_INC42_BROWSER_ENABLED` | `true` | Inc42 Datalabs browser feed |
| `AGRITECH_AGFUNDER_ENABLED` | `true` | AgFunderNews |

Example — daily runs with 5-minute stagger:

```env
AGRITECH_DEFAULT_INTERVAL_MS=86400000
JOB_STAGGER_DELAY_MS=300000
```

---

## Inc42 login — how it works

| Step | What happens |
|---|---|
| `npm run inc42:login` | Opens Chrome with `profiles/inc42/browser-data/` (persistent profile for Google OAuth) |
| You sign in | Google OAuth completes in a normal browser context |
| Press Enter | `agent-browser` connects via CDP, reloads the feed, runs `state save` → `inc42-auth.json` |
| `npm run dev` | Crawl opens a **separate** Chrome window and loads `inc42-auth.json` (cookies + localStorage) |

Why two Chrome contexts? Google OAuth blocks headless/automation profiles. Real Chrome handles login; exported state lets `agent-browser` replay the session for crawling.

Auth files (gitignored):

- `profiles/inc42/browser-data/` — login profile
- `profiles/inc42/inc42-auth.json` — exported session for crawls

---

## Output

Each run updates two fixed Excel files under `./data/` (when `AGRITECH_EXCEL_ENABLED=true`):

```
data/
  agritech-news.xlsx   # mirrors agritech.news (upsert by entry_key each run)
  agritech-logs.xlsx   # mirrors agritech.logs (append each crawl event + run_complete)
```

Postgres (when enabled) holds the same data:

| Table | Purpose |
|---|---|
| `agritech.news` | Startup rows (upsert by `entry_key`) |
| `agritech.logs` | Per-article events + run summaries |

---

## Configuration reference

| Variable | Description |
|---|---|
| `AGRITECH_EXCEL_ENABLED` | Maintain `./data/agritech-news.xlsx` and `./data/agritech-logs.xlsx` (default `true`) |
| `AGRITECH_POSTGRES_ENABLED` | Upsert to Postgres (default `true`) |
| `AGRITECH_AI_ENABLED` | Ollama extraction (default `true`) |
| `AGRITECH_BROWSER_FALLBACK_ENABLED` | agent-browser when HTTP HTML is too thin |
| `AGENT_BROWSER_HEADED` | Show Chrome during Inc42 crawl |
| `AGRITECH_PROFILES_ROOT` | Browser profile directory (default `./profiles`) |
| `MAX_ITEMS_SCANNED_PER_RUN` | Article fetch cap per job run |
| `MAX_NEW_ROWS_PER_RUN` | New row cap per job run |
| `MAX_SECTIONS_PER_RUN` | Section listing cap per source |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | Local LLM endpoint and model |
| `DB_*` | Postgres connection (see `.env.example`) |
| `POSTGRES_HOST_PORT` | Docker host port for Postgres |

At least one of Excel or Postgres must be enabled.

Environment templates:

- `.env.example` — full local setup (Inc42 + AgFunder)
- `.env.docker.example` — Docker app + AgFunder (Inc42 off)

---

## PostgreSQL

Migrations: `db/migrations/001_agritech_schema.sql`, `002_simplify_schema.sql`

```bash
npm run db:migrate
psql -h localhost -p 5432 -U postgres -d agritech
```

| Scenario | `DB_HOST` | Connect from Mac |
|---|---|---|
| App in Docker | `postgres` (compose overrides) | `psql -h localhost -p 5432 ...` |
| App local, PG in Docker | `localhost` | same |

---

## Tests

```bash
npm test
npm run build
```

---

## Project layout

```
src/
  constants/     Source seeds, selectors, defaults
  domain/        Types, dedup, extraction validation, run context
  fragments/     One crawl pipeline per source
  jobs/          Job managers (orchestrator invokes runOnce)
  parsers/       Per-source HTML / snapshot parsers
  persistence/   Excel, Postgres, run history
  integrations/  Ollama, HTTP fetch, agent-browser
  di/            Dependency injection container
  lib/           Logger, scheduler, fragment base
scripts/
  inc42-login.sh One-time Inc42 Google OAuth + state export
  run-migration.mjs
profiles/inc42/  Browser profile + inc42-auth.json (local only)
```

For design rationale, data flow, and how to add sources, see **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

---

## Adding a source

1. `src/constants/<source>.ts` — URLs, selectors, section seeds
2. `src/parsers/<source>.parser.ts` — listing + article parsing
3. `src/fragments/<source>-fragment.ts` — crawl pipeline
4. `src/jobs/<source>-job-manager.ts` — implement `ICrawlJobManager`
5. Register in `di/container.ts` and add to orchestrator job list in `dependencies.ts`

No changes required to persistence, Ollama, or dedup layers.
