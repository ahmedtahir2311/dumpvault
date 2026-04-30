# Changelog

All notable changes to DumpVault are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-1.0 milestones (v0.1 – v0.7) were internal — the first published release is **v1.0.0**.

## [1.0.0] — 2026-04-29

First stable release. Postgres-first, multi-engine roadmap.

### Engines

- **PostgreSQL** — full feature surface. Supabase, Neon, RDS, Railway, and self-hosted all confirmed via `pg_dump`.
- **MySQL / MariaDB** — CLI parity (dump only). Hosted variants documented (PlanetScale, RDS, Cloud SQL, Azure). Restore lands in v1.1+.

### CLI

- `dumpvault init` — generate a starter `dumpvault.yaml`.
- `dumpvault run <name>` — one-shot dump (use with system cron / systemd timers).
- `dumpvault start [--ui]` — daemon mode with cron scheduling, optional embedded web UI.
- `dumpvault status [--json]` — last/next run + size per target.
- `dumpvault history <name> [--json]` — list past dumps with size + sha256.
- `dumpvault verify [name] [--all] [--file <path>] [--json]` — sha256 + gunzip + `pg_restore -l` checks. Exit 2 on any failure.
- `dumpvault restore <name> --to <db>` — Postgres custom-format restore with mandatory checksum verify and confirmation prompt. Supports `--at <iso>`, `--file`, `--clean`, `--create`, `--to-host/port/user/password-env`.
- `dumpvault keygen [--out <path>]` — generate an AES-256 key (mode 0600) for `storage.encryption.key_file`.
- `dumpvault ui` — run only the web UI (no scheduled jobs).

### Daemon

- `croner`-driven cron scheduling with shorthand support (`@daily`, `@hourly`, `@every Nh`).
- Concurrency cap (`scheduler.max_concurrent`, default 2). Same-DB jobs always serialize regardless.
- Overlap-skip — running job for a DB blocks the next tick; skipped runs are logged and the next scheduled tick is honored.
- Jitter (`scheduler.jitter_seconds`) to spread thundering-herd load.
- Graceful SIGINT / SIGTERM — stops schedules, drains in-flight jobs (60s timeout), shuts down web UI.

### Storage

- Path layout: `<root>/<db>/<YYYY>/<MM>/<DD>/<timestamp>.<ext>.gz[.enc]`.
- gzip compression, configurable level for Postgres (`compress: 0–9`).
- SHA-256 sidecar (`<dump>.sha256`) per file. Compatible with `shasum -a 256 -c`.
- **AES-256-GCM streaming encryption** (optional). Format: `[magic 8B "DVENC001"][nonce 12B][ciphertext...][authTag 16B]`. Wrong key / tamper / truncation all surface as clean failures. Encrypted dumps land at `.dump.gz.enc`; restore + verify auto-detect.
- **GFS retention** — `keep_last`, `keep_daily`, `keep_weekly`, `keep_monthly`. Union semantics: a dump survives if any rule selects it. Pruning runs after each successful dump.

### Observability

- Structured JSON logs to stdout via `pino`.
- Optional webhook notifications on `failure` and/or `success`. JSON POST with 10s timeout, Slack/Teams/Discord-compatible `text` field. Delivery failures log a warning but never fail the job.

### Security

- Secrets only via env vars (`*_env`) or referenced files (`*_file`). Inline passwords are a load-time error.
- Config files containing `password_file` references are refused if world-readable.
- Encryption key files are refused if group/world-readable.
- Adapters are read-only against the source DB. DumpVault never modifies it.
- No telemetry. No network calls except the user-configured webhook URL.

### Web UI

- `dumpvault start --ui` or `dumpvault ui` — Hono backend on Bun.serve at `127.0.0.1:8080` (configurable). React 19 SPA with dark theme bundled into the static binary via Bun's HTML import.
- Dashboard with auto-refresh every 10s; per-DB detail view with run-now and verify-latest actions.
- **Installable as a PWA** — manifest + maskable icon + service worker. Click the install icon in your browser to mount the dashboard as a chromeless desktop window with its own dock / Start-menu icon. No Tauri / Electron in the build.
- Restore is intentionally NOT exposed in the UI — too destructive for an unauthenticated localhost surface; CLI only.
- Listening on `0.0.0.0` is allowed but logs a warning — there is no auth, use SSH tunneling for remote access.

### Distribution

- Single static binary per platform via `bun build --compile`: `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`. ~67MB each.
- Multi-arch Docker image at `ghcr.io/ahmedtahir2311/dumpvault` (`linux/amd64`, `linux/arm64`). `postgresql-client` and `default-mysql-client` preinstalled.
- POSIX install script at `scripts/install.sh` — auto-detects OS+arch, fetches the right binary, verifies sha256 against the sidecar, sudo fallback.
- Homebrew tap at `ahmedtahir2311/homebrew-dumpvault` (`brew install ahmedtahir2311/dumpvault/dumpvault`).
- Example `systemd` unit and `launchd` plist in `examples/`.

### CI

- GitHub Actions workflows for typecheck + lint + 54 unit tests on Linux & macOS, plus a release workflow that publishes binaries on `v*` tag push and a Docker workflow that pushes the multi-arch image.

[1.0.0]: https://github.com/ahmedtahir2311/dumpvault/releases/tag/v1.0.0
