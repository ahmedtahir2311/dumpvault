# DumpVault

> Cross-engine database backup tool. One binary, one config, many databases.

[![CI](https://github.com/ahmedtahir2311/dumpvault/actions/workflows/ci.yml/badge.svg)](https://github.com/ahmedtahir2311/dumpvault/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

DumpVault is a single binary you point at any database. It dumps it on a schedule, stores the dump locally, prunes old ones, and tells you when something breaks. No telemetry, no cloud dependency, no runtime to install.

**Status:** v0.7 alpha — Postgres + MySQL/MariaDB at the CLI; restore + integrity verify on Postgres; AES-256-GCM encryption at rest; GFS retention; embedded web UI installable as a PWA (`dumpvault start --ui` or `dumpvault ui`); Homebrew tap + Docker + install script. Pre-1.0 means breaking changes between minor versions are possible.

---

## Install

Pick one:

```bash
# Install script (macOS / Linux, x64 / arm64) — verifies sha256 before installing.
curl -fsSL https://raw.githubusercontent.com/ahmedtahir2311/dumpvault/main/scripts/install.sh | sh

# Homebrew (macOS / Linux)
brew install ahmedtahir2311/dumpvault/dumpvault

# Docker (multi-arch, includes pg_dump and mysqldump)
docker pull ghcr.io/ahmedtahir2311/dumpvault:latest

# Or download a binary directly:
# https://github.com/ahmedtahir2311/dumpvault/releases/latest
```

You also need `pg_dump` (for Postgres) or `mysqldump` (for MySQL) on PATH — the Docker image bundles both; for native installs see `docs/adapters/postgres.md` / `docs/adapters/mysql.md`.

## Quick start

```bash
# 1. Generate a starter config and edit it
dumpvault init
$EDITOR ./dumpvault.yaml

# 2. Dump
export PROD_PG_PASSWORD='...'
dumpvault run prod-app
```

A `.dump.gz` file lands at `~/dumpvault/backups/prod-app/2026/04/29/<timestamp>.dump.gz` with a SHA-256 sidecar. Verify with `shasum -a 256 -c *.sha256`.

To run on a schedule, just leave it running:

```bash
dumpvault start
```

…or wire up [systemd](examples/systemd/dumpvault.service) / [launchd](examples/launchd/com.dumpvault.daemon.plist) for production.

## Example config

```yaml
storage:
  path: ~/dumpvault/backups
  # Optional encryption at rest (AES-256-GCM streaming).
  # Generate a key first: dumpvault keygen --out ~/.dumpvault/master.key
  encryption:
    enabled: true
    key_file: ~/.dumpvault/master.key
  retention:
    keep_last: 7        # always keep the 7 most recent dumps
    keep_daily: 30      # plus newest from each of the last 30 days
    keep_weekly: 12     # plus newest from each of the last 12 ISO weeks
    keep_monthly: 12    # plus newest from each of the last 12 months

# Optional — POST a JSON payload to Slack/Discord/Teams on failure.
notifications:
  webhook: https://hooks.slack.com/services/XXX/YYY/ZZZ
  on: [failure]

scheduler:
  max_concurrent: 2 # cap on parallel dumps
  jitter_seconds: 60 # randomize start to avoid thundering herd

databases:
  - name: prod-app
    engine: postgres
    host: db.example.com
    user: backup_user
    password_env: PROD_PG_PASSWORD # never inline secrets
    database: app
    schedule: "0 2 * * *" # standard cron
    options:
      format: custom # pg_dump -Fc (recommended)
      compress: 6 # gzip 1-9
```

Full spec: [`docs/PRD.md`](docs/PRD.md) §6.

## Commands

```bash
dumpvault init                 # generate a starter dumpvault.yaml
dumpvault run <name>           # one-shot dump (use with system cron / systemd timers)
dumpvault start                # daemon mode — fires jobs on the configured schedule
dumpvault status               # last/next run + size per target  (--json available)
dumpvault history <name>       # list past dumps with size + sha256  (--json available)
dumpvault verify [name]        # check sha256 + gunzip + pg_restore -l on dumps  (--all, --json, --file)
dumpvault restore <name> --to <database>   # restore a Postgres dump (confirms first; --yes to skip)
dumpvault keygen --out <path>  # generate a 32-byte AES-256 key for storage.encryption.key_file
dumpvault start --ui           # daemon + embedded web UI at http://127.0.0.1:8080
dumpvault ui                   # web UI only (no scheduled jobs)
```

## Web UI

```bash
dumpvault start --ui                     # daemon + UI on 127.0.0.1:8080
dumpvault start --ui --ui-port 9090      # custom port
dumpvault ui --port 8080                 # UI only — useful for read-only inspection
```

The UI listens on `127.0.0.1` by default. **No auth in v0.5** — for remote access use SSH tunneling:

```bash
ssh -N -L 8080:127.0.0.1:8080 user@your-server
# then open http://localhost:8080 in your browser
```

The dashboard shows last-dump time, size, and next scheduled run for every configured database. Click a row to see history (size + sha256 + path). "Run now" triggers a one-shot dump. "Verify latest" runs the same `dumpvault verify` checks (sha256 + gunzip + `pg_restore -l`) against the most recent dump. Restore is intentionally not exposed in the UI — too destructive for an unauthenticated localhost surface; use the CLI.

### Install as a desktop app (PWA)

The web UI ships as an installable Progressive Web App. In Chrome, Edge, or Brave, open the dashboard and click the install icon in the address bar (or "Install DumpVault" from the menu). On macOS Safari and iOS, use *Share → Add to Home Screen / Add to Dock*. You get a dock / Start-menu icon and the dashboard opens in its own chromeless window — same UX as a native app, no Tauri / Electron in the build.

The PWA does not cache offline (the daemon must be running for the dashboard to be useful), so it's an installability shell, not an offline-capable app.

## Why not just use `pg_dump` + cron?

| You want…                                        | Bash + cron    | DumpVault                           |
| ------------------------------------------------ | -------------- | ----------------------------------- |
| Run nightly                                      | ✅             | ✅                                  |
| Get notified when it fails                       | write your own | built-in webhook                    |
| Rotate old backups                               | write your own | `keep_last` (GFS in v0.5)           |
| Verify integrity                                 | write your own | SHA-256 sidecars per dump           |
| Avoid overlapping runs on slow databases         | write your own | overlap-skip + per-DB serialization |
| Add MySQL / Mongo without rewriting your scripts | rewrite        | one config, one CLI                 |
| Audit the source code                            | n/a            | one MIT-licensed TypeScript repo    |

DumpVault is **not** a replacement for `pgbackrest` or `restic`. They go deeper (PITR, deduplication, encryption-at-rest). DumpVault goes wider — one tool, many engines, sensible defaults. Use the right one for your job.

## Roadmap to v1.0

We're going **deep on Postgres before going wide**. v0.1–v1.0 takes Postgres from "works" to "production-ready" (CLI ✅ → restore ✅ → encryption → web UI → distribution polish). MySQL stays at CLI-level until v1.1+.

| Release  | Theme                                                 | Status      |
| -------- | ----------------------------------------------------- | ----------- |
| v0.1     | Postgres adapter + CLI + daemon + webhooks            | done        |
| v0.2     | MySQL / MariaDB CLI parity                            | done        |
| v0.3     | `dumpvault restore` + `dumpvault verify`              | done        |
| v0.4     | Encryption at rest (AES-256-GCM) + full GFS retention | done        |
| v0.5     | Embedded web UI (`dumpvault start --ui`)              | done        |
| v0.6     | Distribution polish — Homebrew tap, Docker, install script | done   |
| v0.7     | PWA install (manifest + service worker + icon) — desktop-app feel without Tauri | done |
| **v1.0** | Tag, release, Show HN                                 | next        |
| v1.1+    | SQLite, MongoDB, Redis, MSSQL, ClickHouse, S3-compatible cloud sync | planned |

Tier-3 engines (Cassandra, CockroachDB, InfluxDB, Elasticsearch, …) will be community/plugin contributions. See [`docs/PRD.md`](docs/PRD.md) §5.

## Security model

- Secrets only via env vars (`*_env`) or file references (`*_file`). Inline passwords are a load-time error.
- Config files containing `password_file` references are refused if world-readable.
- Engine binaries (`pg_dump`) must be on PATH. We never bundle, download, or auto-update them.
- **No telemetry.** No network calls except the user-configured webhook URL. Auditable in this repo.
- Adapters are read-only against your source database. DumpVault never modifies it.

## Restore (manual until v0.6)

`dumpvault restore` lands in v0.6. Until then, restore manually:

```bash
gunzip -k 2026-04-29T02-00-00Z.dump.gz
pg_restore --host=... --dbname=app_restored --clean --if-exists \
  --no-owner --no-privileges 2026-04-29T02-00-00Z.dump
```

Detailed recipe in [`docs/adapters/postgres.md`](docs/adapters/postgres.md).

## Development

Prerequisites: [Bun](https://bun.sh) ≥ 1.0 and `pg_dump` on PATH.

```bash
bun install
bun run dev --help     # run the CLI from source
bun run build          # produce dist/dumpvault static binary
bun run typecheck      # tsc --noEmit
bun run lint           # biome check
bun run format         # biome format --write
bun test               # 18+ unit tests
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the PR checklist and how to add a new engine adapter.

## Documentation

- [`docs/PRD.md`](docs/PRD.md) — product spec, roadmap, locked decisions
- [`docs/PLAN.md`](docs/PLAN.md) — original implementation plan (partially superseded by PRD)
- [`docs/adapters/postgres.md`](docs/adapters/postgres.md) — Postgres adapter: setup, hosted variants, restore recipe, common errors
- [`docs/adapters/mysql.md`](docs/adapters/mysql.md) — MySQL/MariaDB adapter: setup, hosted variants (PlanetScale, RDS, Cloud SQL), restore recipe, common errors

## License

[MIT](LICENSE) © 2026 Ahmed Tahir.
