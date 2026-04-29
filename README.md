# DumpVault

> Cross-engine database backup tool. One binary, one config, many databases.

[![CI](https://github.com/ahmedtahir2311/dumpvault/actions/workflows/ci.yml/badge.svg)](https://github.com/ahmedtahir2311/dumpvault/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

DumpVault is a single binary you point at any database. It dumps it on a schedule, stores the dump locally, prunes old ones, and tells you when something breaks. No telemetry, no cloud dependency, no runtime to install.

**Status:** v0.1 alpha — Postgres-only, MVP feature complete, not yet released. Pre-1.0 means breaking changes between minor versions are possible.

---

## Quick start

```bash
# 1. Install (manual for now — Homebrew tap and install script land at v0.1 release)
curl -fsSL https://github.com/ahmedtahir2311/dumpvault/releases/latest/download/dumpvault-darwin-arm64 \
  -o /usr/local/bin/dumpvault && chmod +x /usr/local/bin/dumpvault

# 2. Generate a starter config and edit it
dumpvault init
$EDITOR ./dumpvault.yaml

# 3. Dump
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
  retention:
    keep_last: 7

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
```

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

## Engine roadmap

| Release  | Engine                                             | Status      |
| -------- | -------------------------------------------------- | ----------- |
| **v0.1** | PostgreSQL (incl. Supabase / Neon / RDS / Railway) | in progress |
| v0.2     | MySQL / MariaDB (incl. PlanetScale)                | next        |
| v0.3     | SQLite                                             | planned     |
| v0.4     | MongoDB                                            | planned     |
| v0.5     | _(hardening — encryption + GFS retention)_         | planned     |
| v0.6     | _(`dumpvault restore` command)_                    | planned     |
| v0.7     | _(embedded web UI — `dumpvault start --ui`)_       | planned     |
| v1.x     | Redis, MSSQL, ClickHouse, S3-compatible cloud sync | planned     |

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
- [`docs/adapters/postgres.md`](docs/adapters/postgres.md) — Postgres adapter setup, hosted variants, restore recipe, common errors

## License

[MIT](LICENSE) © 2026 Ahmed Tahir.
