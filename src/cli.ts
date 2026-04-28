#!/usr/bin/env bun
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { loadConfig } from './config/load.ts';
import { SAMPLE_CONFIG } from './config/sample.ts';
import { exitCodeFor } from './errors.ts';
import { runJob } from './jobs/runner.ts';
import { log } from './logging/log.ts';

const program = new Command();

program
  .name('dumpvault')
  .description('Cross-engine database backup tool')
  .version('0.1.0-pre');

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
      await runJob(db, config, log);
      process.exit(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err: msg }, 'job failed');
      process.exit(exitCodeFor(err));
    }
  });

program
  .command('start')
  .description('Run as a daemon, firing scheduled jobs (Phase 2)')
  .option('-c, --config <path>', 'config file path', './dumpvault.yaml')
  .action((opts: { config: string }) => {
    log.error(
      { config: opts.config },
      'daemon mode lands in Phase 2 — for now use `dumpvault run <name>` from system cron',
    );
    process.exit(2);
  });

program
  .command('status')
  .description('Show last run / next run / health for each configured target (Phase 2)')
  .option('-c, --config <path>', 'config file path', './dumpvault.yaml')
  .action(() => {
    log.error('status command lands in Phase 2');
    process.exit(2);
  });

program
  .command('history')
  .description('List past dumps for a target (Phase 2)')
  .argument('<name>', 'database name from config')
  .action(() => {
    log.error('history command lands in Phase 2');
    process.exit(2);
  });

program.parseAsync(process.argv);
