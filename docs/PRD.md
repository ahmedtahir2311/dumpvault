# DumpVault — Product Requirements Document

**Status:** v1.0 — MVP scoped, decisions locked
**Owner:** Ahmed Tahir
**Date:** 2026-04-27 (rewritten from Draft v0.1)
**License:** MIT

---

## 1. Problem

Developers, indie hackers, and small teams run a heterogeneous mix of databases (Postgres, MySQL, MongoDB, SQLite, Supabase, etc.). Taking regular off-host backups is universally important but universally annoying:

- Each engine has its own dump tool (`pg_dump`, `mysqldump`, `mongodump`, …) with its own flags.
- Hosted services (Supabase, PlanetScale, Neon) wrap the same engines but add their own auth quirks.
- Cron + bash scripts are fragile: silent failures, no retention policy, no reporting, no encryption.
- Existing tools are either heavyweight enterprise (Veeam, Bacula) or single-engine (`pgbackrest`).

There is no lightweight, cross-engine, "just works" tool that runs locally, takes scheduled dumps, and keeps them somewhere safe.

## 2. Vision

**DumpVault is a single binary you point at any database. It dumps it on a schedule and stores the dump locally with sensible defaults.**

- One config file, many databases.
- Works for every common engine (rolled out one engine at a time).
- Local-first storage. Cloud sync, encryption, and web UI are post-MVP.
- Open source (MIT), free forever, no telemetry by default.

## 3. Target users

| Persona                 | Need                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------- |
| Solo dev / indie hacker | "I just want my side-project Postgres backed up nightly without writing bash."      |
| Small team / startup    | "We have Postgres + Mongo. We need one tool that grows with us."                    |
| Self-hoster             | "I'm running Supabase / Appwrite on a VPS and need offsite-able dumps."             |
| Agency                  | "We manage 20 client DBs across engines. Give us a dashboard." (post-MVP UI target) |

Not a target for v1: enterprises with compliance regimes (HIPAA / SOC 2 attestation, immutable WORM storage, etc.). We don't fight that battle.

## 4. MVP scope

DumpVault ships in waves. The MVP (this document) is intentionally small. Each subsequent release adds one engine or one capability — no big-bang releases.

### MVP goals

1. Schedule **Postgres** dumps via a single YAML config file.
2. Run as a one-shot CLI (`dumpvault run <name>`) or a long-running daemon (`dumpvault start`).
3. Store dumps locally with gzip compression, SHA-256 sidecar integrity files, and `keep_last` retention.
4. Surface failures via exit codes, structured JSON logs, and an optional webhook.
5. Ship as a single static binary (via `bun build --compile`) for macOS (arm64 / x64) and Linux (arm64 / x64).

### MVP non-goals (deferred to later releases)

| Feature                                       | Deferred to                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| MySQL / MariaDB adapter                       | v0.2                                                                               |
| SQLite adapter                                | v0.3                                                                               |
| MongoDB adapter                               | v0.4                                                                               |
| Encryption at rest (AES-256-GCM)              | v0.5 — until then, README recommends FS-level encryption (LUKS / FileVault)        |
| Full GFS retention (daily / weekly / monthly) | v0.5                                                                               |
| `dumpvault restore` command                   | v0.6 — until then, manual `pg_restore` instructions in `docs/adapters/postgres.md` |
| Web UI (embedded dashboard)                   | v0.7                                                                               |
| Cloud storage backends (S3, R2, B2, GCS)      | v1.x                                                                               |
| Tauri desktop wrapper                         | post-v1, only if user demand                                                       |
| Hosted SaaS                                   | never                                                                              |

## 5. Supported databases

**MVP (v0.1):** PostgreSQL only — including hosted variants (Supabase, Neon, RDS, Railway). Compatibility with hosted variants is best-effort and documented as users report.

**Roadmap (one per release, in priority order):**

- v0.2: MySQL / MariaDB (incl. PlanetScale)
- v0.3: SQLite (file copy + `.backup` cmd)
- v0.4: MongoDB
- v1.x Tier 2: Redis, Microsoft SQL Server, ClickHouse, DynamoDB
- Tier 3 (community / plugin): Cassandra, CockroachDB, InfluxDB, Elasticsearch, etc.

The architecture (TS adapter interface) makes adding a new engine an isolated change — one new file in `src/adapters/`.

## 6. MVP feature spec

### 6.1 Configuration

A single declarative YAML file (`dumpvault.yaml`). TOML / JSON support is post-MVP.

```yaml
storage:
  path: ~/dumpvault/backups
  retention:
    keep_last: 7

notifications:
  webhook: https://hooks.slack.com/... # optional
  on: [failure] # optional, default: [failure]

scheduler:
  max_concurrent: 2 # global cap on parallel jobs
  jitter_seconds: 60 # +/- randomization to avoid thundering herd

databases:
  - name: prod-app
    engine: postgres
    host: db.example.com
    port: 5432
    user: backup_user
    password_env: PROD_PG_PASSWORD # never inline secrets
    database: app
    schedule: "0 2 * * *" # cron
    options:
      format: custom # pg_dump -Fc
      compress: 6
```

**Config rules:**

- Secrets only via `*_env` (env var name) or `*_file` (path to a file). Inline secrets are rejected at load time.
- Schema-validated with `zod`; loud errors on unknown fields, missing required fields, or malformed cron.
- Refuse to run if the config file is world-readable AND contains any `*_file` references.

### 6.2 Scheduling

- Standard 5-field cron + shorthand (`@daily`, `@hourly`, `@every 6h`).
- Two run modes:
  - **Daemon mode** (`dumpvault start`): long-running process, fires jobs internally.
  - **One-shot mode** (`dumpvault run <name>`): single job, exits when done. Suitable for system cron / systemd timers.
- **Concurrency:** at most `scheduler.max_concurrent` jobs run in parallel (default: 2). Jobs targeting the same database are always serialized regardless. Excess jobs queue.
- **Overlap policy:** if a job is still running when its next cron tick fires, the new run is **skipped**, a warning is logged, and the next scheduled tick is honored normally.
- **Jitter:** each job adds `±jitter_seconds` random delay to spread load.

### 6.3 Storage

- Local filesystem only in MVP.
- Path layout: `<root>/<db_name>/<YYYY>/<MM>/<DD>/<timestamp>.sql.gz`
- Compression: gzip (Node's built-in `zlib`). Zstd and per-DB overrides are post-MVP.
- Integrity: SHA-256 sidecar file per dump (`<dump>.sha256`).
- Retention: `keep_last: N` only in MVP. Pruning runs after each successful dump. GFS (`keep_daily` / `keep_weekly` / `keep_monthly`) is post-MVP.

### 6.4 Observability

- Structured JSON logs to stdout (via `pino`). Optional file destination via config.
- `dumpvault status`: shows last run / next run / size / health for each configured target.
- `dumpvault history <name>`: lists past dumps with size, duration, status.
- **Webhook (optional):** generic JSON POST. Slack / Discord / Teams compatible. Off by default.
- **Exit codes:**
  - `0` — success
  - `1` — config error
  - `2` — dump command failed (engine binary returned non-zero or crashed)
  - `3` — storage error (write failed, retention failed)
  - `4` — internal error (unexpected)

### 6.5 Security

- Secrets only via env vars (`*_env`) or file references (`*_file`). Inline secrets are a load-time error.
- No telemetry. No network calls except to user-configured webhooks. The README explicitly states this.
- Engine binaries (`pg_dump`) are required on PATH; we never bundle, download, or auto-update them.
- `dumpvault start` runs as the invoking user; documented examples for systemd / launchd use a dedicated `dumpvault` user.

### 6.6 Distribution

- Single static binary per platform via `bun build --compile`. Targets:
  - macOS arm64
  - macOS x64
  - Linux arm64
  - Linux x64
- Install methods in MVP:
  - Direct download from GitHub Releases
  - Install script (`curl -fsSL ... | sh`)
- Homebrew tap, Docker image, and Windows binary are post-MVP.

## 7. Post-MVP roadmap

| Release | Theme     | Headline feature                                                                       |
| ------- | --------- | -------------------------------------------------------------------------------------- |
| v0.2    | Engine    | MySQL / MariaDB adapter                                                                |
| v0.3    | Engine    | SQLite adapter                                                                         |
| v0.4    | Engine    | MongoDB adapter                                                                        |
| v0.5    | Hardening | Encryption (AES-256-GCM), full GFS retention                                           |
| v0.6    | UX        | `dumpvault restore` command                                                            |
| v0.7    | UX        | Embedded web UI (`dumpvault start --ui`) — Plausible / Portainer-style local dashboard |
| v1.0    | Stability | First stable release; semver guarantees begin                                          |
| v1.x    | Storage   | S3-compatible cloud sync (S3, R2, B2, GCS, Azure)                                      |
| v1.x    | Engines   | Redis, MSSQL, ClickHouse, DynamoDB                                                     |
| post-v1 | Native UX | Tauri desktop wrapper (only if user demand exists)                                     |

## 8. Success metrics (honest version)

| Metric                                  | Realistic 6-month target                 | Stretch                                       |
| --------------------------------------- | ---------------------------------------- | --------------------------------------------- |
| GitHub stars                            | 200                                      | 1,000                                         |
| Active community                        | qualitative — issues / PRs / discussions | self-reported via opt-in version-ping in v1.x |
| Engines supported                       | 4 (Tier 1 complete)                      | 6 (+ Redis, ClickHouse)                       |
| Mean time-to-first-backup after install | < 5 min                                  | < 2 min                                       |
| Issue first-response time               | < 48 h                                   | < 24 h                                        |

## 9. Risks

| Risk                                        | Mitigation                                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Reinventing `pgbackrest` / `restic`         | Position as **multi-engine orchestration**, not a low-level engine. Wrap, don't replace. README has a "Why not X?" section. |
| Engine quirks explode scope                 | Adapter contract isolates engine-specific code. Tier 3 engines are explicitly "best effort."                                |
| Secrets handling is easy to get wrong       | Force `*_env` / `*_file` pattern in schema; refuse inline secrets at load time.                                             |
| Cron edge cases (DST, missed runs, overlap) | Use `croner` (battle-tested). Explicit overlap policy: skip + log + wait for next tick.                                     |
| Maintainer burnout (solo project)           | MVP scope is intentionally narrow. Each release adds one thing. Issues triaged weekly, not real-time.                       |
| User loses data because of a DumpVault bug  | Adapters never delete source data. Retention only prunes our own output dir. SHA-256 sidecars verify integrity.             |

## 10. Locked decisions

| #   | Decision           | Choice                                                                        |
| --- | ------------------ | ----------------------------------------------------------------------------- |
| 1   | Language / runtime | TypeScript on Bun                                                             |
| 2   | Distribution       | `bun build --compile` static binaries                                         |
| 3   | Config format      | YAML in MVP; TOML / JSON post-MVP                                             |
| 4   | Engine binaries    | required on PATH; never bundled                                               |
| 5   | Scheduler library  | `croner`                                                                      |
| 6   | CLI library        | `commander`                                                                   |
| 7   | Schema validation  | `zod`                                                                         |
| 8   | Logger             | `pino`                                                                        |
| 9   | Lint / format      | `biome`                                                                       |
| 10  | Test runner        | Bun built-in (`bun test`)                                                     |
| 11  | Encryption (MVP)   | OFF — recommend FS-level encryption; AES-256-GCM in v0.5                      |
| 12  | Compression (MVP)  | gzip; zstd post-MVP                                                           |
| 13  | Webhooks (MVP)     | optional, off by default                                                      |
| 14  | Restore (MVP)      | manual `pg_restore` documented; CLI command in v0.6                           |
| 15  | Concurrency model  | global `max_concurrent: 2`; same-DB jobs always serialized                    |
| 16  | Overlap policy     | skip + log + wait for next tick                                               |
| 17  | Daemon supervision | example systemd / launchd configs in `examples/`; we don't build a supervisor |
| 18  | License            | MIT                                                                           |
| 19  | Telemetry          | none, ever, in OSS build                                                      |
| 20  | UI (MVP)           | none — CLI + JSON logs only. Web UI in v0.7                                   |
| 21  | Project name       | DumpVault (working name)                                                      |

## 11. MVP definition of done

A user can:

1. Download a single binary for their platform from GitHub Releases.
2. Write a 10-line `dumpvault.yaml` pointing at their Postgres, with the password in an env var.
3. Run `dumpvault run prod-pg` and see a `<root>/prod-pg/2026/04/27/<ts>.sql.gz` file appear, plus a `.sha256` sidecar.
4. Run `dumpvault start` and see the same dump fire automatically at the configured cron time.
5. Configure a webhook and get a JSON POST when a dump fails.
6. Restore by running the documented `gunzip + pg_restore` recipe.

When those six things work reliably on macOS arm64 and Linux x64, MVP ships as v0.1.0.

## 12. Out-of-scope clarifications

To prevent scope creep during implementation, the following are explicitly **not** in MVP:

- Multi-region or off-host replication
- Point-in-time recovery / WAL streaming
- Plugin system for community adapters (post-v1)
- macOS menu-bar app
- Windows binary (post-MVP — adds CI complexity)
- Internationalization
- Per-job alternate storage destinations
- Per-dump custom hooks (`on_success: ./script.sh`) — useful but post-MVP

If a user requests these, link them to the relevant roadmap milestone in §7.
