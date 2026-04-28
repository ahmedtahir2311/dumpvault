# DumpVault — Initial Implementation Plan

**Companion to:** [PRD.md](PRD.md)
**Status:** Partially superseded by PRD v1.0 — language is now **TypeScript on Bun** (not Go). The architecture diagram (§1), phased roadmap (§4), and repo layout (§5) are still directionally correct, but the Go-specific code samples (§3) and tooling references (`golangci-lint`, `gofumpt`, `go.mod`) will be re-translated to TS during Phase 1. Locked decisions live in PRD §10.
**Date:** 2026-04-27

---

## 1. Architecture overview

```
                    ┌─────────────────────────┐
                    │     dumpvault (CLI)     │
                    │  start / run / status   │
                    └──────────┬──────────────┘
                               │
           ┌───────────────────┼────────────────────┐
           ▼                   ▼                    ▼
    ┌────────────┐      ┌──────────────┐    ┌──────────────┐
    │  Config    │      │  Scheduler   │    │  Storage     │
    │  loader    │      │  (cron)      │    │  manager     │
    └────────────┘      └──────┬───────┘    └──────┬───────┘
                               │                   │
                               ▼                   │
                       ┌──────────────┐            │
                       │ Job runner   │────────────┘
                       │ (per DB)     │  writes dump file +
                       └──────┬───────┘  sha256 sidecar
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
     ┌────────────┐    ┌────────────┐    ┌────────────┐
     │ Postgres   │    │ MySQL      │    │ Mongo      │   ...adapters
     │ adapter    │    │ adapter    │    │ adapter    │
     └────────────┘    └────────────┘    └────────────┘
            │                 │                 │
            ▼                 ▼                 ▼
        pg_dump          mysqldump         mongodump
```

### Core components

| Component | Responsibility |
|---|---|
| **CLI** | Argument parsing, subcommands, stdout formatting. |
| **Config loader** | Parse + validate YAML/TOML/JSON. Resolve `*_env` and `*_file` refs. Reject inline secrets. |
| **Scheduler** | Convert cron expressions → next-run times. Drive the job runner. Handle overlap/jitter. |
| **Job runner** | For each scheduled job: build adapter, invoke dump, stream output through compress→encrypt→hash→write. |
| **Adapter interface** | Minimal contract every engine implements. See §3. |
| **Storage manager** | Path layout, retention pruning, integrity verification, optional encryption envelope. |
| **Notifier** | Webhook + log emission on success/failure. |

## 2. Tech stack decision

**Recommendation: Go.**

| Criterion | Go | Node/TS | Rust |
|---|---|---|---|
| Single static binary | ✅ | ❌ (needs Node) | ✅ |
| Cross-compile to Linux/Mac/Win/ARM | ✅ trivial | ⚠️ pkg/nexe | ✅ but slower |
| Concurrency for parallel dumps | ✅ goroutines | ✅ async | ✅ tokio |
| Ecosystem fit (DB drivers, cron) | ✅ mature | ✅ huge | ⚠️ thinner |
| Time-to-MVP | medium | fast | slow |
| Operator install UX | best | needs runtime | best |

Go wins on the metric that matters most for a backup tool: **operators must trust the install**. A static binary with no runtime dependency is the right shape. We accept slower prototyping vs Node.

If the team strongly prefers TS, second choice is Node 20+ with `pkg`/`bun build --compile` for distribution. Avoid mixing; pick one.

## 3. Adapter contract

Every engine adapter implements:

```go
type Adapter interface {
    // Validate that required external binaries exist (pg_dump, mongodump, ...).
    Preflight(ctx context.Context) error

    // Stream dump bytes to the writer. Caller handles compression/encryption/hashing.
    Dump(ctx context.Context, w io.Writer) error

    // File extension for the raw dump (e.g. "sql", "archive", "bson").
    Extension() string

    // Engine label for logs/metrics.
    Engine() string
}
```

This keeps engine quirks isolated. Adding ClickHouse later = one new file.

## 4. Phased roadmap

### Phase 0 — Repo bootstrap (week 1)
- Initialize Go module, `cmd/dumpvault` entry point.
- Set up `golangci-lint`, `gofumpt`, GitHub Actions CI.
- License (MIT), CONTRIBUTING.md, CODE_OF_CONDUCT.md, issue templates.
- Decide branching strategy (trunk-based, conventional commits, Changesets-style release notes).

### Phase 1 — Walking skeleton (weeks 2–3)
- CLI with `init`, `run`, `status` commands.
- Config loader (YAML + env-var resolution + schema validation).
- One adapter end-to-end: **Postgres**.
- Local storage with gzip + retention (`keep_last` only).
- Stdout JSON logs.
- **Deliverable:** `dumpvault run my-pg` produces a `.sql.gz` file. Smoke test on a real DB.

### Phase 2 — MVP feature complete (weeks 4–6)
- Add adapters: MySQL, SQLite, MongoDB.
- Daemon mode (`dumpvault start`) with internal cron scheduler.
- Full retention policy (GFS).
- AES-256-GCM encryption envelope.
- SHA-256 sidecar integrity files.
- Webhook notifier.
- `dumpvault history` and improved `status`.
- Docs site (mkdocs or just README + `/docs`).

### Phase 3 — Public launch (week 7)
- Homebrew tap, install script, prebuilt binaries via GoReleaser.
- Docker image.
- Show HN / r/selfhosted / r/devops launch post.
- Set up Discussions for community engine requests.

### Phase 4 — v1.x (post-launch)
- Tier 2 adapters (Redis, MSSQL, ClickHouse).
- `dumpvault restore`.
- S3-compatible storage backend.
- Web UI (read-only dashboard first).

## 5. Repository layout (proposed)

```
dumpvault/
├── cmd/
│   └── dumpvault/          # main.go, CLI wiring
├── internal/
│   ├── adapters/
│   │   ├── postgres/
│   │   ├── mysql/
│   │   ├── sqlite/
│   │   └── mongo/
│   ├── config/             # parser + schema
│   ├── scheduler/          # cron + job dispatch
│   ├── storage/            # path layout, retention, encrypt, hash
│   ├── notifier/           # webhook
│   └── logging/
├── docs/
│   ├── PRD.md
│   ├── PLAN.md
│   └── adapters/           # per-engine setup notes
├── examples/
│   └── dumpvault.yaml
├── .github/workflows/
├── LICENSE
├── README.md
└── go.mod
```

## 6. Key design decisions to lock before coding

| # | Decision | Default lean | Needs sign-off |
|---|---|---|---|
| 1 | Language | Go | yes |
| 2 | Config format | YAML (auto-accept TOML/JSON) | yes |
| 3 | Engine binaries | require on PATH; document install | yes |
| 4 | Scheduler library | `robfig/cron/v3` | low-risk |
| 5 | Encryption default | off, opt-in via config | yes |
| 6 | Compression default | gzip-6, zstd opt-in | low-risk |
| 7 | License | MIT | yes |
| 8 | Telemetry | none in OSS build | yes (locked: none) |
| 9 | Project name | DumpVault | yes |

## 7. First milestone — definition of done

A user can:
1. `brew install dumpvault` (or download a binary).
2. Write a 10-line YAML config pointing at their Postgres.
3. Run `dumpvault run prod-pg` and see a compressed dump appear locally.
4. Add `schedule: "0 2 * * *"` and run `dumpvault start` and see it fire nightly.
5. Get a Slack message if the dump fails.

If those five things work reliably across macOS + Linux, MVP is done.

## 8. Open questions to resolve next

1. Confirm language choice (Go vs Node/TS).
2. Confirm name (DumpVault?) and grab GitHub org / npm name / domain.
3. Pick the two reference databases for development (suggest: a local Postgres + a Supabase project, since you already use Supabase).
4. Hosting for docs site — GitHub Pages is fine for v1.
5. Funding / sustainability model — pure OSS, sponsorware, or open-core later? (Decide before launch so the README sets expectations honestly.)

---

**Next action:** review this plan, lock the §6 decisions, and I'll scaffold Phase 0 (repo + CI + a stub Postgres adapter) so we can start dumping by end of week 1.
