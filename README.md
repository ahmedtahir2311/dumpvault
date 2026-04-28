# DumpVault

> Cross-engine database backup tool. One binary, one config, many databases.

**Status:** pre-MVP scaffold (v0.1.0-pre). Not yet usable. See [`docs/PRD.md`](docs/PRD.md) for the spec and [`docs/PLAN.md`](docs/PLAN.md) for the implementation plan.

## What it is

DumpVault is a single binary you point at any database. It dumps it on a schedule and stores the dump locally with sensible defaults.

- One YAML config, many databases.
- Local-first storage. No cloud dependency.
- MIT licensed. Open source. No telemetry, ever.
- Postgres in v0.1 — MySQL, SQLite, MongoDB rolling out one per release.

## Why not just use `pg_dump` + cron?

Because cron + bash silently fails. DumpVault gives you:
- Scheduled dumps with overlap-skip and jitter
- Retention rotation
- SHA-256 integrity sidecars
- Structured JSON logs and exit codes
- Optional webhook notifications

…all from one config file, across engines.

## MVP roadmap

| Release | Adds |
|---|---|
| **v0.1 (in progress)** | Postgres adapter, CLI, daemon, gzip + `keep_last` retention, JSON logs, webhooks |
| v0.2 | MySQL / MariaDB |
| v0.3 | SQLite |
| v0.4 | MongoDB |
| v0.5 | AES-256-GCM encryption + GFS retention |
| v0.6 | `dumpvault restore` |
| v0.7 | Embedded web UI |

Full roadmap in [`docs/PRD.md`](docs/PRD.md) §7.

## Development

### Prerequisites

- **Bun** (≥ 1.0). Install:
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```
  Or via Homebrew: `brew install oven-sh/bun/bun`
- **`pg_dump`** on PATH (for testing the Postgres adapter; usually shipped with Postgres client packages).

### Setup

```bash
git clone <repo>
cd dumpvault
bun install
```

### Common scripts

```bash
bun run dev         # run the CLI from source
bun run build       # produce a static binary at dist/dumpvault
bun run lint        # biome check
bun run format      # biome format --write
bun run typecheck   # tsc --noEmit
bun test            # run tests
```

### CLI commands (currently stubs — Phase 1 will fill them in)

```bash
dumpvault init              # generate a starter dumpvault.yaml
dumpvault run <name>        # one-shot dump for a single configured DB
dumpvault start             # run as daemon, fire jobs on schedule
dumpvault status            # show last run / next run / health per target
dumpvault history <name>    # list past dumps for a target
```

## License

MIT — see [`LICENSE`](LICENSE).
