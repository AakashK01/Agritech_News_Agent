# AgriTech Startup Discovery Tracker

Automated discovery of agrifood and agtech startups from news sources. The tracker crawls configured sites, extracts startup names and news summaries with **Ollama**, and stores results in **Excel** and/or **PostgreSQL**.

**Standalone project** — no Keel, no private npm registry, no LinkedIn dependencies. All code lives in this directory.

## What it does

1. **Crawl** — fetches listing pages from news sources (HTTP or headed browser for login-gated feeds)
2. **Detect changes** — skips unchanged sections and duplicate articles via content hashing
3. **Extract** — sends article text to a local Ollama model for structured startup data
4. **Persist** — writes dated Excel workbooks and upserts rows into Postgres (`agritech.news`)
5. **Schedule** — runs all enabled source jobs **once per week** (configurable), with a **delay between jobs** so they do not overlap

### Current sources

| Source | Site | Fetch mode |
|---|---|---|
| **AgFunder** | [agfundernews.com](https://agfundernews.com) | HTTP |
| **Inc42** | [inc42.com](https://inc42.com) | HTTP (homepage, IPO tracker) + browser (agritech Datalabs feed) |

Each source is an independent **job** wired into a single **orchestrator**. New sources can be added without changing existing ones (see [ARCHITECTURE.md](./ARCHITECTURE.md)).

## Prerequisites

- **Node.js 18+**
- **[Ollama](https://ollama.com/)** with a JSON-capable model (default `llama3.2`)
- **PostgreSQL** (optional — disable with `AGRITECH_POSTGRES_ENABLED=false`)
- **agent-browser** + Chrome (optional — for Inc42 Datalabs login feed or JS fallback)

## Quick start (local)

```bash
cd agritech-tracker
cp .env.example .env
npm install
npm run build

# Host: start Ollama
ollama serve
ollama pull llama3.2

# One full orchestrator cycle (all enabled jobs, then exit)
npm run dev:once
```

## Quick start (Docker)

Postgres + app in containers; Ollama on the host.

```bash
cd agritech-tracker
cp .env.docker.example .env

ollama serve
ollama pull llama3.2

docker compose up --build -d
docker compose logs -f agritech-tracker
```

Single cycle:

```bash
docker compose run --rm -e AGRITECH_RUN_ONCE=true agritech-tracker
```

## How jobs run

The **orchestrator** (`src/dependencies.ts`) owns scheduling. It does **not** give each source its own timer.

```
Every AGRITECH_DEFAULT_INTERVAL_MS (default 7 days):
  1. Run AgFunder job (if enabled)
  2. Wait JOB_STAGGER_DELAY_MS (default 20 minutes)
  3. Run Inc42 job (if enabled)
  4. Wait until next weekly cycle
```

| Variable | Default | Meaning |
|---|---|---|
| `AGRITECH_DEFAULT_INTERVAL_MS` | `604800000` (7 days) | Time between orchestrator cycles |
| `JOB_STAGGER_DELAY_MS` | `1200000` (20 min) | Pause between jobs in one cycle |
| `AGRITECH_RUN_ONCE` | `false` | Run one cycle and exit (good for cron / CI) |

Per-source toggles:

| Variable | Default | Source |
|---|---|---|
| `AGRITECH_AGFUNDER_ENABLED` | `true` | AgFunderNews |
| `AGRITECH_INC42_ENABLED` | `false` | Inc42 |

Example — daily runs with 5-minute stagger:

```env
AGRITECH_DEFAULT_INTERVAL_MS=86400000
JOB_STAGGER_DELAY_MS=300000
```

## Output

Each job run creates:

```
data/runs/YYYY-MM-DD/
  agritech-startups.xlsx      # all sources in one workbook
  run-summary.json
  logs/crawl.json
```

Global dedup indexes:

- `data/url-content-index.json` — article URL → content hash (+ extraction status)
- `data/section-snapshots.json` — listing page hashes (skip unchanged sections)

## Inc42 browser login

The [Inc42 agritech feed](https://inc42.com/industry/agritech/) requires login. Uses a persistent **headed Chrome** profile (same idea as LinkedIn automation elsewhere, but implemented only for Inc42 here):

```bash
AGRITECH_INC42_ENABLED=true
AGRITECH_INC42_BROWSER_ENABLED=true
AGRITECH_RUN_ONCE=true npm run dev:once
```

Sign in when Chrome opens. Session persists under `profiles/inc42/browser-data/`.

## Configuration reference

| Variable | Description |
|---|---|
| `AGRITECH_EXCEL_ENABLED` | Write Excel per run (default `true`) |
| `AGRITECH_POSTGRES_ENABLED` | Upsert to Postgres (default `true` in Docker example) |
| `AGRITECH_AI_ENABLED` | Ollama extraction (default `true`) |
| `AGRITECH_BROWSER_FALLBACK_ENABLED` | agent-browser when HTTP HTML is too thin |
| `AGRITECH_PROFILES_ROOT` | Browser profile directory (default `./profiles`) |
| `MAX_ITEMS_SCANNED_PER_RUN` | Article fetch cap per job run |
| `MAX_NEW_ROWS_PER_RUN` | New row cap per job run (re-extract updates are exempt) |
| `MAX_SECTIONS_PER_RUN` | Section listing cap per source |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | Local LLM endpoint and model |
| `DB_*` | Postgres connection (see `.env.example`) |
| `POSTGRES_HOST_PORT` | Docker host port for Postgres |

At least one of Excel or Postgres must be enabled.

## PostgreSQL

Schema: `db/migrations/001_agritech_schema.sql`

```bash
npm run db:migrate          # local
psql -h localhost -p 5432 -U postgres -d agritech   # verify
```

| Scenario | `DB_HOST` | Connect from Mac |
|---|---|---|
| App in Docker | `postgres` (compose sets this) | `psql -h localhost -p 5432 ...` |
| App local, PG in Docker | `localhost` | same |

## Tests

```bash
npm test
npm run build
```

## Project layout

```
src/
  constants/     Source seeds, selectors, defaults
  domain/        Types, dedup, extraction validation, run context
  fragments/     One crawl pipeline per source
  jobs/          Job managers (orchestrator invokes runOnce)
  parsers/       Per-source HTML / snapshot parsers
  persistence/   Excel, Postgres, indexes, run history
  integrations/  Ollama, HTTP fetch, agent-browser
  di/            Dependency injection container
  lib/           Logger, scheduler, fragment base
```

For design rationale, data flow, and how to add sources, see **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

## Adding a source

1. `src/constants/<source>.ts` — URLs, selectors, section seeds
2. `src/parsers/<source>.parser.ts` — listing + article parsing
3. `src/fragments/<source>-fragment.ts` — crawl pipeline
4. `src/jobs/<source>-job-manager.ts` — implement `ICrawlJobManager`
5. Register in `di/container.ts` and add to orchestrator job list in `dependencies.ts`

No changes required to persistence, Ollama, or dedup layers.
