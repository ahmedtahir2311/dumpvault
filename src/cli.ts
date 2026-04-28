#!/usr/bin/env bun
import { Command } from 'commander';

const program = new Command();

program
  .name('dumpvault')
  .description('Cross-engine database backup tool')
  .version('0.1.0-pre');

program
  .command('init')
  .description('Generate a starter dumpvault.yaml in the current directory')
  .action(() => {
    console.error('not yet implemented — Phase 1 (see docs/PRD.md §11)');
    process.exit(2);
  });

program
  .command('run')
  .description('Run a single dump immediately')
  .argument('<name>', 'database name from config')
  .option('-c, --config <path>', 'config file path', './dumpvault.yaml')
  .action((name: string, opts: { config: string }) => {
    console.error(`not yet implemented — would run job "${name}" with config "${opts.config}"`);
    process.exit(2);
  });

program
  .command('start')
  .description('Run as a daemon, firing scheduled jobs')
  .option('-c, --config <path>', 'config file path', './dumpvault.yaml')
  .action((opts: { config: string }) => {
    console.error(`not yet implemented — would start daemon with config "${opts.config}"`);
    process.exit(2);
  });

program
  .command('status')
  .description('Show last run / next run / health for each configured target')
  .option('-c, --config <path>', 'config file path', './dumpvault.yaml')
  .action((opts: { config: string }) => {
    console.error(`not yet implemented — would read status from config "${opts.config}"`);
    process.exit(2);
  });

program
  .command('history')
  .description('List past dumps for a target')
  .argument('<name>', 'database name from config')
  .option('-c, --config <path>', 'config file path', './dumpvault.yaml')
  .action((name: string, opts: { config: string }) => {
    console.error(`not yet implemented — would list history for "${name}" using "${opts.config}"`);
    process.exit(2);
  });

program.parseAsync(process.argv);
