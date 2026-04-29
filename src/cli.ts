#!/usr/bin/env bun
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { Cron } from 'croner';
import { type ResolvedConfig, expandHome, loadConfig } from './config/load.ts';
import { SAMPLE_CONFIG } from './config/sample.ts';
import { exitCodeFor } from './errors.ts';
import { runJobWithNotifications } from './jobs/runner.ts';
import { log } from './logging/log.ts';
import { Daemon } from './scheduler/daemon.ts';
import { dbRoot } from './storage/paths.ts';
import { collectDumps, readSha256Sidecar } from './storage/scan.ts';
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
  .command('run')
  .description('Run a single dump immediately')
  .argument('<name>', 'database name from config')
  .option('-c, --config <path>', 'config file path', './dumpvault.yaml')
  .action(async (name: string, opts: { config: string }) => {
    try {
      const config = loadConfig(opts.config);
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
  .description('Run as a daemon, firing scheduled jobs')
  .option('-c, --config <path>', 'config file path', './dumpvault.yaml')
  .action((opts: { config: string }) => {
    let daemon: Daemon | null = null;
    try {
      const config = loadConfig(opts.config);
      daemon = new Daemon(config, log);

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

program.parseAsync(process.argv);
