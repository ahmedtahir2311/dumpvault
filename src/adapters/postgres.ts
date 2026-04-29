import { spawn } from 'node:child_process';
import type { Writable } from 'node:stream';
import type { ResolvedDatabase } from '../config/load.ts';
import { DumpError } from '../errors.ts';
import type { Adapter } from './adapter.ts';

export class PostgresAdapter implements Adapter {
  constructor(private readonly db: ResolvedDatabase) {}

  engine(): string {
    return 'postgres';
  }

  extension(): string {
    return this.db.options.format === 'plain' ? 'sql' : 'dump';
  }

  preflight(): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('pg_dump', ['--version'], { stdio: 'pipe' });
      proc.on('error', () => {
        reject(
          new DumpError(
            'pg_dump not found on PATH. Install Postgres client tools (e.g. `brew install libpq`).',
          ),
        );
      });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new DumpError(`pg_dump --version exited with code ${code}`));
      });
    });
  }

  dump(out: Writable): Promise<void> {
    const args = this.buildArgs();

    return new Promise((resolve, reject) => {
      const proc = spawn('pg_dump', args, {
        env: { ...process.env, PGPASSWORD: this.db.password },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout.pipe(out);

      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      proc.on('error', (err) => {
        reject(new DumpError(`pg_dump failed to start: ${err.message}`, { cause: err }));
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new DumpError(
              `pg_dump for "${this.db.name}" exited with code ${code}: ${stderr.trim()}`,
            ),
          );
        }
      });
    });
  }

  private buildArgs(): string[] {
    const { db } = this;
    const opts = db.options;

    const args = [
      '--host',
      db.host,
      '--port',
      String(db.port),
      '--username',
      db.user,
      '--dbname',
      db.database,
      '--no-password',
    ];

    args.push('--format', formatFlag(opts.format));

    if (opts.format === 'custom' || opts.format === 'tar') {
      args.push(`--compress=${opts.compress}`);
    }

    if (opts.schemas) for (const s of opts.schemas) args.push('--schema', s);
    if (opts.exclude_tables) for (const t of opts.exclude_tables) args.push('--exclude-table', t);
    if (opts.no_owner) args.push('--no-owner');
    if (opts.no_privileges) args.push('--no-privileges');

    return args;
  }
}

function formatFlag(format: 'custom' | 'plain' | 'tar'): string {
  switch (format) {
    case 'custom':
      return 'c';
    case 'plain':
      return 'p';
    case 'tar':
      return 't';
  }
}
