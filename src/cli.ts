#!/usr/bin/env bun
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { Cron } from 'croner';
import { type ResolvedConfig, expandHome, loadConfig } from './config/load.ts';
import { SAMPLE_CONFIG } from './config/sample.ts';
import { exitCodeFor } from './errors.ts';
import { runRestore } from './jobs/restore.ts';
import { runJobWithNotifications } from './jobs/runner.ts';
import { runVerify } from './jobs/verify.ts';
import { log } from './logging/log.ts';
import { Daemon } from './scheduler/daemon.ts';
import { generateKeyBase64 } from './storage/encryption.ts';
import { dbRoot } from './storage/paths.ts';
import { collectDumps, readSha256Sidecar } from './storage/scan.ts';
import { startWebUI } from './ui/server.ts';
import { errMsg, humanSize, printTable } from './util/format.ts';

const program = new Command();

program.name('dumpvault').description('Cross-engine database backup tool').version('0.1.0-pre');

program
  .command('init')
  .description('Generate a starter dumpvault.yaml in the current directory')
  .option('-o, --output <path>', 'output path', './dumpvault.yaml')
  .action((opts: { output: string }) => {
    const target = resolve(opts.output);
    if (existsSync(target)) {
      log.error({ target }, 'config file already exists; refusing to overwrite');
      process.exit(1);
    }
    writeFileSync(target, SAMPLE_CONFIG);
    log.info({ target }, 'created starter config — edit it before running');
  });

program
  .command('keygen')
  .description('Generate a fresh AES-256 encryption key (base64) for storage.encryption.key_file')
  .option('-o, --out <path>', 'write the key to this file (mode 600)')
  .action((opts: { out?: string }) => {
    const key = generateKeyBase64();
    if (!opts.out) {
      // Print only — caller pipes to a file or copies it.
      console.log(key);
      return;
    }
    const target = resolve(opts.out);
    if (existsSync(target)) {
      log.error({ target }, 'key file already exists; refusing to overwrite');
      process.exit(1);
    }
    writeFileSync(target, `${key}\n`, { mode: 0o600 });
    log.info(
      { target },
      'wrote 32-byte AES key (mode 600). Reference it from storage.encryption.key_file.',
    );
  });

program
  .command('run')
  .description('Run a single dump immediately')
  .argument('<name>', 'database name from config')
  .option('-c, --config <path>', 'config file path', './dumpvault.yaml')
  .action(async (name: string, opts: { config: string }) => {
    try {
      const config = loadConfig(opts.config, { resolveOnly: name });
      const db = config.databases.find((d) => d.name === name);
      if (!db) {
        log.error(
          { name, available: config.databases.map((d) => d.name) },
          'database not found in config',
        );
        process.exit(1);
      }
      await runJobWithNotifications(db, config, log);
      process.exit(0);
    } catch (err) {
      log.error({ err: errMsg(err) }, 'job failed');
      process.exit(exitCodeFor(err));
    }
  });

program
  .command('start')
  .description('Run as a daemon, firing scheduled jobs (optionally with embedded web UI)')
  .option('-c, --config <path>', 'config file path', './dumpvault.yaml')
  .option('--ui', 'enable the embedded web UI alongside the cron daemon')
  .option('--ui-port <port>', 'web UI port (default 8080)', (v) => Number.parseInt(v, 10))
  .option(
    '--ui-host <host>',
    'web UI hostname (default 127.0.0.1; use 0.0.0.0 to expose — no auth)',
  )
  .action((opts: { config: string; ui?: boolean; uiPort?: number; uiHost?: string }) => {
    let daemon: Daemon | null = null;
    try {
      const config = loadConfig(opts.config);
      daemon = new Daemon(config, log, {
        ui: opts.ui ? { port: opts.uiPort ?? 8080, host: opts.uiHost ?? '127.0.0.1' } : undefined,
      });

      const shutdown = async (signal: string): Promise<void> => {
        log.info({ signal }, 'shutdown signal received');
        if (daemon) await daemon.stop();
        process.exit(0);
      };
      process.on('SIGINT', () => void shutdown('SIGINT'));
      process.on('SIGTERM', () => void shutdown('SIGTERM'));

      daemon.start();
      // Daemon's croner schedules keep the event loop alive.
    } catch (err) {
      log.error({ err: errMsg(err) }, 'failed to start daemon');
      process.exit(exitCodeFor(err));
    }
  });

program
  .command('ui')
  .description('Run only the web UI (no scheduled jobs) — useful for read-only inspection')
  .option('-c, --config <path>', 'config file path', './dumpvault.yaml')
  .option('--port <port>', 'port (default 8080)', (v) => Number.parseInt(v, 10))
  .option('--host <host>', 'hostname (default 127.0.0.1)')
  .action((opts: { config: string; port?: number; host?: string }) => {
    try {
      const config = loadConfig(opts.config);
      const server = startWebUI({
        config,
        log,
        port: opts.port ?? 8080,
        host: opts.host ?? '127.0.0.1',
      });
      const shutdown = (signal: string): void => {
        log.info({ signal }, 'shutdown signal received');
        server.stop();
        process.exit(0);
      };
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    } catch (err) {
      log.error({ err: errMsg(err) }, 'failed to start web UI');
      process.exit(exitCodeFor(err));
    }
  });

interface StatusRow {
  name: string;
  engine: string;
  schedule: string;
  lastDump: { path: string; mtime: string; size: number } | null;
  nextRun: string | null;
}

function buildStatus(config: ResolvedConfig): StatusRow[] {
  const root = expandHome(config.storage.path);
  return config.databases.map((db) => {
    const dumps = collectDumps(dbRoot(root, db.name));
    dumps.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const last = dumps[0];
    let nextRun: string | null = null;
    try {
      const next = new Cron(db.schedule, { paused: true }).nextRun();
      nextRun = next?.toISOString() ?? null;
    } catch {
      nextRun = null;
    }
    return {
      name: db.name,
      engine: db.engine,
      schedule: db.schedule,
      lastDump: last
        ? { path: last.path, mtime: new Date(last.mtimeMs).toISOString(), size: last.size }
        : null,
      nextRun,
    };
  });
}

program
  .command('status')
  .description('Show last run / next run / size for each configured target')
  .option('-c, --config <path>', 'config file path', './dumpvault.yaml')
  .option('--json', 'output as JSON')
  .action((opts: { config: string; json?: boolean }) => {
    try {
      const config = loadConfig(opts.config, { skipSecrets: true });
      const rows = buildStatus(config);
      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
      } else {
        printTable(
          ['NAME', 'SCHEDULE', 'LAST DUMP (UTC)', 'SIZE', 'NEXT RUN (UTC)'],
          rows.map((r) => [
            r.name,
            r.schedule,
            r.lastDump?.mtime ?? '(never)',
            r.lastDump ? humanSize(r.lastDump.size) : '-',
            r.nextRun ?? '-',
          ]),
        );
      }
      process.exit(0);
    } catch (err) {
      log.error({ err: errMsg(err) }, 'status failed');
      process.exit(exitCodeFor(err));
    }
  });

program
  .command('history')
  .description('List past dumps for a target')
  .argument('<name>', 'database name from config')
  .option('-c, --config <path>', 'config file path', './dumpvault.yaml')
  .option('--json', 'output as JSON')
  .action((name: string, opts: { config: string; json?: boolean }) => {
    try {
      const config = loadConfig(opts.config, { skipSecrets: true });
      const db = config.databases.find((d) => d.name === name);
      if (!db) {
        log.error({ name }, 'database not found in config');
        process.exit(1);
      }
      const root = expandHome(config.storage.path);
      const dumps = collectDumps(dbRoot(root, db.name));
      dumps.sort((a, b) => b.mtimeMs - a.mtimeMs);

      const rows = dumps.map((d) => ({
        timestamp: new Date(d.mtimeMs).toISOString(),
        size: d.size,
        sha256: readSha256Sidecar(d.path),
        path: d.path,
      }));

      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
      } else if (rows.length === 0) {
        console.log(`(no dumps yet for "${name}")`);
      } else {
        printTable(
          ['TIMESTAMP (UTC)', 'SIZE', 'SHA-256 (prefix)', 'PATH'],
          rows.map((r) => [
            r.timestamp,
            humanSize(r.size),
            r.sha256 ? r.sha256.slice(0, 16) : '(missing)',
            r.path,
          ]),
        );
      }
      process.exit(0);
    } catch (err) {
      log.error({ err: errMsg(err) }, 'history failed');
      process.exit(exitCodeFor(err));
    }
  });

program
  .command('restore')
  .description('Restore a Postgres dump to a target database (destructive — confirms first)')
  .argument('<name>', 'database name from config')
  .requiredOption('--to <database>', 'target database name (required)')
  .option(
    '--at <timestamp>',
    'restore the dump matching this ISO timestamp prefix (default: latest)',
  )
  .option('--file <path>', 'restore an arbitrary dump file (overrides --at and latest-pick)')
  .option('--to-host <host>', 'target host (default: source host from config)')
  .option('--to-port <port>', 'target port (default: source port)', (v) => Number.parseInt(v, 10))
  .option('--to-user <user>', 'target user (default: source user)')
  .option('--to-password-env <var>', 'env var holding the target password (default: reuse source)')
  .option('--clean', 'pass --clean --if-exists to pg_restore (drop existing objects first)')
  .option('--create', 'pass --create to pg_restore (create the target database)')
  .option('-c, --config <path>', 'config file path', './dumpvault.yaml')
  .option('--yes', 'skip the confirmation prompt')
  .action(
    async (
      name: string,
      opts: {
        config: string;
        to: string;
        at?: string;
        file?: string;
        toHost?: string;
        toPort?: number;
        toUser?: string;
        toPasswordEnv?: string;
        clean?: boolean;
        create?: boolean;
        yes?: boolean;
      },
    ) => {
      try {
        const config = loadConfig(opts.config, { resolveOnly: name });
        await runRestore(
          {
            config,
            dbName: name,
            at: opts.at,
            file: opts.file,
            toDatabase: opts.to,
            toHost: opts.toHost,
            toPort: opts.toPort,
            toUser: opts.toUser,
            toPasswordEnv: opts.toPasswordEnv,
            clean: opts.clean ?? false,
            create: opts.create ?? false,
            yes: opts.yes ?? false,
          },
          log,
        );
        process.exit(0);
      } catch (err) {
        log.error({ err: errMsg(err) }, 'restore failed');
        process.exit(exitCodeFor(err));
      }
    },
  );

program
  .command('verify')
  .description('Verify dump integrity (sha256, gunzip, pg_restore -l)')
  .argument('[name]', 'database name from config (default: all configured DBs)')
  .option('-c, --config <path>', 'config file path', './dumpvault.yaml')
  .option('--all', 'verify every dump for the target(s); default is just the latest')
  .option('--file <path>', 'verify a specific file (skips config lookup)')
  .option('--json', 'output results as JSON')
  .action(
    async (
      name: string | undefined,
      opts: { config: string; all?: boolean; file?: string; json?: boolean },
    ) => {
      try {
        // For verify, no DB connection is made — skip secrets entirely.
        const config = opts.file
          ? // Still need a parsed config for path resolution; load with skipSecrets if available.
            // If there's no config (--file used in isolation), fall back to a minimal stub.
            tryLoadOrStub(opts.config)
          : loadConfig(opts.config, { skipSecrets: true });

        const results = await runVerify(
          { config, dbName: name, all: opts.all ?? false, file: opts.file },
          log,
        );

        if (opts.json) {
          console.log(JSON.stringify(results, null, 2));
        } else if (results.length === 0) {
          console.log('(no dumps found)');
        } else {
          printTable(
            ['DUMP', 'SIZE', 'SHA-256', 'GUNZIP', 'pg_restore', 'OK'],
            results.map((r) => [
              r.path,
              '-', // size lookup omitted; user can `ls -lh`
              r.shaOk ? 'ok' : 'FAIL',
              r.gunzipOk ? 'ok' : 'FAIL',
              r.pgRestoreOk === null ? '-' : r.pgRestoreOk ? 'ok' : 'FAIL',
              r.ok ? '✓' : '✗',
            ]),
          );
        }
        const anyFailed = results.some((r) => !r.ok);
        process.exit(anyFailed ? 2 : 0);
      } catch (err) {
        log.error({ err: errMsg(err) }, 'verify failed');
        process.exit(exitCodeFor(err));
      }
    },
  );

function tryLoadOrStub(path: string): ResolvedConfig {
  try {
    return loadConfig(path, { skipSecrets: true });
  } catch {
    // Allow `dumpvault verify --file <path>` without any config file present.
    return {
      storage: { path: '/tmp', retention: { keep_last: 1 } },
      scheduler: { max_concurrent: 1, jitter_seconds: 0 },
      databases: [],
    };
  }
}

program.parseAsync(process.argv);
