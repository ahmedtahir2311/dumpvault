# Postgres adapter

DumpVault uses `pg_dump` under the hood — same tool you'd use by hand, just orchestrated.

## Prerequisites

- `pg_dump` on PATH. Verify with `pg_dump --version`.
  - macOS: `brew install libpq && brew link --force libpq`
  - Debian / Ubuntu: `sudo apt install postgresql-client`
  - Alpine: `apk add postgresql-client`
- Network reachability from the DumpVault host to your Postgres instance.
- A user with `pg_read_all_data` (or equivalent SELECT grants) on the target database. Do **not** use a superuser.

## Hosted variants

| Provider | Notes |
|---|---|
| Supabase | Use the connection string under Project → Settings → Database → Connection pooler is **not** required for `pg_dump`; use the direct connection. SSL is enforced. |
| Neon | Endpoint hostname includes `-pooler` for pooled or no suffix for direct. Use direct for `pg_dump`. SSL required. |
| AWS RDS | Standard `pg_dump` works. Ensure security group allows your DumpVault host. |
| Railway | Use the public TCP proxy connection string from the Railway dashboard. |
| PlanetScale | Postgres support in beta — see provider docs. |

If a provider gives you trouble, please open a GitHub issue with the connection error so we can document it here.

## Config example

```yaml
databases:
  - name: prod-app
    engine: postgres
    host: db.example.com
    port: 5432
    user: backup_user
    password_env: PROD_PG_PASSWORD
    database: app
    schedule: "0 2 * * *"
    options:
      format: custom        # one of: custom (default, recommended), plain, directory, tar
      compress: 6           # 1-9; only applies to format=custom and format=directory
      # Optional pg_dump passthroughs:
      # schemas: ["public"]
      # exclude_tables: ["audit_log"]
      # no_owner: true
      # no_privileges: true
```

## Output

Dumps land at:

```
<storage.path>/<name>/<YYYY>/<MM>/<DD>/<timestamp>.sql.gz
<storage.path>/<name>/<YYYY>/<MM>/<DD>/<timestamp>.sql.gz.sha256
```

The `.sha256` sidecar is the SHA-256 of the `.sql.gz` file. Verify with:

```bash
shasum -a 256 -c <timestamp>.sql.gz.sha256
```

## Restoring (manual until v0.6)

DumpVault MVP focuses on producing reliable dumps; the `dumpvault restore` command lands in v0.6. Until then, restore manually.

### Restore from a `format: custom` dump (default)

```bash
# 1. Decompress the gzip wrapper.
gunzip -k 2026-04-27T02-00-00Z.sql.gz
# Now you have 2026-04-27T02-00-00Z.sql (a pg_dump custom-format archive)

# 2. Restore with pg_restore.
pg_restore \
  --host=restore-target.example.com \
  --port=5432 \
  --username=postgres \
  --dbname=app_restored \
  --clean --if-exists \
  --no-owner --no-privileges \
  2026-04-27T02-00-00Z.sql
```

### Restore from a `format: plain` dump

```bash
gunzip -c 2026-04-27T02-00-00Z.sql.gz | psql \
  --host=restore-target.example.com \
  --port=5432 \
  --username=postgres \
  --dbname=app_restored
```

### Sanity-check before restoring

1. Verify the SHA-256 sidecar matches.
2. Restore into an empty test database first, never directly over production.
3. Run a row-count or checksum query against critical tables to confirm completeness.

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `pg_dump: command not found` | `pg_dump` not on PATH | Install Postgres client tools (see Prerequisites). |
| `connection to server ... failed: SSL required` | Hosted DB enforces SSL | Append `?sslmode=require` or set the appropriate env var. (Detailed handling in DumpVault is on the v0.2 roadmap.) |
| `permission denied for relation X` | Backup user missing SELECT | Grant `pg_read_all_data` or per-table SELECT. |
| `pg_dump: server version mismatch` | Local `pg_dump` older than server | Install matching `pg_dump` version. |
