# Contributing to DumpVault

Thanks for considering a contribution. DumpVault is small and intentionally narrow — please read the **Roadmap** in [`docs/PRD.md`](docs/PRD.md) §7 before filing issues or PRs to make sure your idea fits the project's direction.

## What we will accept

- Bug fixes for supported engines (currently: Postgres).
- Documentation improvements.
- New engine adapters that match the contract in [`src/adapters/adapter.ts`](src/adapters/adapter.ts) and follow the engine release order in PRD §7 (next up: MySQL).
- Tests, especially around config edge cases and adapter behavior.

## What we won't accept (yet)

- Hosted-SaaS features. DumpVault is local-first, by design.
- Telemetry, version pings, or any default network calls beyond the user-configured webhook.
- Tier 3 engines outside the roadmap — open a discussion first.
- Refactors with no functional or test-coverage win.

## Development

```bash
git clone <fork-url>
cd dumpvault
bun install
bun run typecheck    # tsc --noEmit
bun run lint         # biome check src
bun test             # 18+ unit tests
bun run dev --help   # run the CLI from source
```

## PR checklist

Before opening a PR:

- [ ] `bun run typecheck` is clean
- [ ] `bun run lint` is clean (run `bun run format` first)
- [ ] `bun test` passes
- [ ] You added tests for new behavior, especially adapter logic and config schema rules
- [ ] You ran a real end-to-end dump if you touched the dump pipeline
- [ ] PR title follows conventional commits (`feat:`, `fix:`, `docs:`, `chore:`)

## Adding a new engine adapter

1. Implement the [`Adapter`](src/adapters/adapter.ts) interface in `src/adapters/<engine>.ts`.
2. Add the engine to the discriminated union in [`src/config/schema.ts`](src/config/schema.ts) with its own options object.
3. Wire it in [`src/jobs/runner.ts`](src/jobs/runner.ts) (factory based on `db.engine`).
4. Add `docs/adapters/<engine>.md` mirroring the structure of [`docs/adapters/postgres.md`](docs/adapters/postgres.md): prerequisites, hosted variants, config example, output, restore recipe, common errors.
5. Add tests covering the args-builder and any engine-specific config rules.

## Reporting security issues

Please do **not** open a public issue for security vulnerabilities. Email `ahmeed.tahir@setrick.com` with details. We aim to respond within 7 days.

## License

By contributing, you agree your contribution is licensed under MIT, the same as the project.
