# MySQL / MariaDB adapter

DumpVault uses `mysqldump` under the hood. The password is passed via a temporary `--defaults-extra-file` (mode 600, deleted after the dump finishes) — `MYSQL_PWD` is deprecated and would corrupt the dump pipeline with a stderr warning.

## Prerequisites

- `mysqldump` on PATH. Verify with `mysqldump --version`.
  - macOS: `brew install mysql-client && brew link --force mysql-client`
  - Debian / Ubuntu: `sudo apt install default-mysql-client` (or `mariadb-client`)
  - Alpine: `apk add mysql-client`
- Network reachability from the DumpVault host to your MySQL / MariaDB instance.
- A user with sufficient grants — typically `SELECT, LOCK TABLES, SHOW VIEW, EVENT, TRIGGER, PROCESS` plus `SHOW DATABASES` on the target. For replicas you may also need `REPLICATION CLIENT`.

  ```sql
  CREATE USER 'backup_user'@'%' IDENTIFIED BY '...';
  GRANT SELECT, LOCK TABLES, SHOW VIEW, EVENT, TRIGGER, PROCESS, RELOAD
    ON *.* TO 'backup_user'@'%';
  FLUSH PRIVILEGES;
  ```

## Hosted variants

| Provider     | Notes                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| PlanetScale  | Set `ssl_mode: REQUIRED`. Use the connection string credentials from the PlanetScale dashboard. PlanetScale's MySQL is Vitess — `--single-transaction` is the right default. |
| AWS RDS      | Standard `mysqldump` works. Ensure security group allows your DumpVault host. Set `ssl_mode: REQUIRED` if you've enforced SSL.         |
| Google Cloud SQL | Whitelist DumpVault host's IP, or use the Cloud SQL Auth Proxy and point DumpVault at the local proxy port.                        |
| Azure Database for MySQL | `ssl_mode: REQUIRED` is mandatory. Use the fully-qualified server name as `host`.                                          |
| MariaDB      | The MariaDB `mysqldump` is a drop-in replacement. Same config works.                                                                   |

If a provider gives you trouble, please open a GitHub issue with the connection error so we can document it here.

## Config example

```yaml
databases:
  - name: prod-mysql
    engine: mysql
    host: db.example.com
    port: 3306
    user: backup_user
    password_env: PROD_MYSQL_PASSWORD
    database: app
    schedule: "0 2 * * *"
    options:
      single_transaction: true   # default — required for InnoDB consistency
      routines: true             # default — include stored procs / functions
      triggers: true             # default
      events: false              # default — flip to true if you use MySQL events
      ssl_mode: REQUIRED         # for hosted services that enforce TLS
      # exclude_tables: [audit_log, sessions]
      # no_data: true            # schema-only dump
      # add_drop_table: true     # add DROP TABLE before each CREATE
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

```bash
gunzip -c 2026-04-29T02-00-00Z.sql.gz | mysql \
  --host=restore-target.example.com \
  --port=3306 \
  --user=root \
  --password \
  app_restored
```

### Sanity-check before restoring

1. Verify the SHA-256 sidecar matches.
2. Restore into an empty test database first, never directly over production.
3. Run `SELECT count(*) FROM <critical_table>` to confirm row counts.

## InnoDB vs MyISAM

`single_transaction: true` (the default) gives a consistent snapshot for **InnoDB** tables only — MyISAM and MEMORY tables are dumped non-transactionally. If you have a mixed-engine database, expect those tables to be a point-in-time snapshot of when each was read, not a single global instant. For pure-MyISAM databases you'd typically use `--lock-tables` (currently not exposed) — open an issue if you need it.

## Common errors

| Error                                                                       | Cause                                                                  | Fix                                                                                       |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `mysqldump: command not found`                                              | `mysqldump` not on PATH                                                | Install MySQL client tools (see Prerequisites).                                            |
| `Access denied for user 'backup_user'@'%' (using password: YES)`            | Password mismatch or missing grants                                    | Re-run the GRANT statement above. Test with `mysql -u backup_user -p ...`.                |
| `Unknown table 'COLUMN_STATISTICS' in information_schema`                   | mysqldump 8.x against MySQL 5.7                                        | Upgrade either side, or open an issue — we may add a `--column-statistics=0` passthrough. |
| `SSL connection is required`                                                | Hosted DB enforces TLS                                                 | Set `options.ssl_mode: REQUIRED` (or stricter) in your config.                            |
| `Got error: 2002: Can't connect to local MySQL server through socket ...`   | mysqldump trying to use a Unix socket because `host: localhost`        | Use `host: 127.0.0.1` instead — forces TCP.                                                |
