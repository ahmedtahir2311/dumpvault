import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Writable } from 'node:stream';
import type { ResolvedMysqlDatabase } from '../config/load.ts';
import { DumpError } from '../errors.ts';
import type { Adapter } from './adapter.ts';

/**
 * Adapter for MySQL / MariaDB. Shells out to `mysqldump` with the password
 * passed via a temporary `--defaults-extra-file` (mode 600) — `MYSQL_PWD` is
 * deprecated and emits a warning to stderr that pollutes the dump pipeline.
 */
export class MysqlAdapter implements Adapter {
  constructor(private readonly db: ResolvedMysqlDatabase) {}

  engine(): string {
    return 'mysql';
  }

  extension(): string {
    return 'sql';
  }

  preflight(): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('mysqldump', ['--version'], { stdio: 'pipe' });
      proc.on('error', () => {
        reject(
          new DumpError(
            'mysqldump not found on PATH. Install MySQL client tools (e.g. `brew install mysql-client`).',
          ),
        );
      });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new DumpError(`mysqldump --version exited with code ${code}`));
      });
    });
  }

  dump(out: Writable): Promise<void> {
    const defaultsFile = writeDefaultsFile(this.db.password);
    const args = this.buildArgs(defaultsFile);

    return new Promise((resolve, reject) => {
      const proc = spawn('mysqldump', args, { stdio: ['ignore', 'pipe', 'pipe'] });

      proc.stdout.pipe(out);

      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      const cleanup = (): void => {
        try {
          unlinkSync(defaultsFile);
        } catch {
          // ignore — best effort
        }
      };

      proc.on('error', (err) => {
        cleanup();
        reject(new DumpError(`mysqldump failed to start: ${err.message}`, { cause: err }));
      });

      proc.on('close', (code) => {
        cleanup();
        if (code === 0) {
          resolve();
        } else {
          reject(
            new DumpError(
              `mysqldump for "${this.db.name}" exited with code ${code}: ${stderr.trim()}`,
            ),
          );
        }
      });
    });
  }

  /** Visible for tests. */
  buildArgs(defaultsFile: string): string[] {
    const { db } = this;
    const opts = db.options;

    const args = [
      `--defaults-extra-file=${defaultsFile}`,
      '--host',
      db.host,
      '--port',
      String(db.port),
      '--user',
      db.user,
    ];

    if (opts.single_transaction) args.push('--single-transaction');
    if (opts.routines) args.push('--routines');
    if (opts.triggers) args.push('--triggers');
    if (opts.events) args.push('--events');
    if (opts.no_data) args.push('--no-data');
    if (opts.add_drop_table) args.push('--add-drop-table');
    if (opts.ssl_mode) args.push(`--ssl-mode=${opts.ssl_mode}`);

    if (opts.exclude_tables) {
      for (const t of opts.exclude_tables) {
        args.push(`--ignore-table=${db.database}.${t}`);
      }
    }

    args.push(db.database);
    return args;
  }
}

function writeDefaultsFile(password: string): string {
  const path = join(tmpdir(), `dumpvault-mysql-${randomBytes(8).toString('hex')}.cnf`);
  // Escape password so a literal quote in the password doesn't break the file.
  const escaped = password.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  writeFileSync(path, `[client]\npassword="${escaped}"\n`, { mode: 0o600 });
  return path;
}
