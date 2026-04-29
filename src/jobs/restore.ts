import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { basename, resolve as resolvePath } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import type { Logger } from 'pino';
import { type ResolvedConfig, type ResolvedPostgresDatabase, expandHome } from '../config/load.ts';
import { ConfigError, DumpError } from '../errors.ts';
import { Decryptor, isEncryptedPath } from '../storage/encryption.ts';
import { dbRoot } from '../storage/paths.ts';
import { type DumpEntry, collectDumps, readSha256Sidecar } from '../storage/scan.ts';
import { errMsg, humanSize } from '../util/format.ts';

export interface RestoreOptions {
  config: ResolvedConfig;
  dbName: string;
  /** ISO-like timestamp prefix to match a specific dump (e.g. "2026-04-29" or "2026-04-29T13"). */
  at?: string;
  /** Absolute path to a specific dump file (overrides --at and the latest-pick). */
  file?: string;

  /** Required: target database name. */
  toDatabase: string;
  toHost?: string;
  toPort?: number;
  toUser?: string;
  toPasswordEnv?: string;

  /** Pass `--clean --if-exists` to pg_restore. */
  clean: boolean;
  /** Pass `--create` to pg_restore. */
  create: boolean;

  /** Skip the interactive confirmation prompt. */
  yes: boolean;
  /** Confirmation handler — defaults to a TTY readline prompt; injected for tests. */
  confirmFn?: (summary: RestoreSummary) => Promise<boolean>;
}

export interface RestoreSummary {
  source: { path: string; sha256: string; sizeBytes: number; mtime: Date };
  target: { host: string; port: number; user: string; database: string };
  modes: { clean: boolean; create: boolean };
}

/**
 * Find the dump file to restore.
 * Returns the matched DumpEntry or null if none.
 *
 * @param dumps   newest-first list
 * @param prefix  user-supplied --at value, e.g. "2026-04-29T13:31:37Z" or "2026-04-29"
 */
export function findDumpByPrefix(dumps: DumpEntry[], prefix: string): DumpEntry | null {
  // The on-disk filename uses dashes for time separators (ISO would have colons).
  const normalized = prefix.replace(/:/g, '-');
  for (const d of dumps) {
    if (basename(d.path).startsWith(normalized)) return d;
  }
  return null;
}

export async function runRestore(opts: RestoreOptions, log: Logger): Promise<void> {
  const db = findDatabase(opts);
  if (db.engine !== 'postgres') {
    throw new ConfigError(
      `restore for engine "${db.engine}" lands in v1.1. Postgres only in v0.3.`,
    );
  }

  const dumpPath = chooseDumpPath(opts, db);
  validateDumpFormat(dumpPath);

  const expectedSha = readSha256Sidecar(dumpPath);
  const stat = statSync(dumpPath);

  if (!expectedSha) {
    throw new DumpError(
      `refusing to restore ${dumpPath}: sha256 sidecar is missing. Run \`dumpvault verify\` first to investigate.`,
    );
  }

  log.info({ dumpPath, sha256: expectedSha }, 'verifying source dump checksum');
  const actualSha = await sha256OfFile(dumpPath);
  if (actualSha.toLowerCase() !== expectedSha.toLowerCase()) {
    throw new DumpError(
      `refusing to restore ${dumpPath}: sha256 mismatch ` +
        `(sidecar=${expectedSha}, file=${actualSha}). The dump may be corrupt.`,
    );
  }

  const target = resolveTarget(opts, db);

  const summary: RestoreSummary = {
    source: {
      path: dumpPath,
      sha256: expectedSha,
      sizeBytes: stat.size,
      mtime: stat.mtime,
    },
    target: {
      host: target.host,
      port: target.port,
      user: target.user,
      database: opts.toDatabase,
    },
    modes: { clean: opts.clean, create: opts.create },
  };

  if (!opts.yes) {
    const confirmFn = opts.confirmFn ?? defaultConfirm;
    const confirmed = await confirmFn(summary);
    if (!confirmed) {
      log.info('restore aborted by user');
      return;
    }
  }

  // Decryption stage if the source is encrypted.
  let pre: NodeJS.ReadWriteStream[];
  if (isEncryptedPath(dumpPath)) {
    if (!opts.config.encryptionKey) {
      throw new ConfigError(
        `${dumpPath} is encrypted but no encryption key is configured. Set storage.encryption.key_file in your config.`,
      );
    }
    pre = [new Decryptor(opts.config.encryptionKey)];
  } else {
    pre = [];
  }

  await runPgRestore(dumpPath, pre, target, opts.toDatabase, opts.clean, opts.create, log);
  log.info({ target: opts.toDatabase }, 'restore complete');
}

function findDatabase(opts: RestoreOptions): ResolvedPostgresDatabase {
  const db = opts.config.databases.find((d) => d.name === opts.dbName);
  if (!db) {
    throw new ConfigError(
      `database "${opts.dbName}" not found in config. ` +
        `Available: ${opts.config.databases.map((d) => d.name).join(', ') || '(none)'}`,
    );
  }
  if (db.engine !== 'postgres') {
    throw new ConfigError(
      `restore for engine "${db.engine}" lands in v1.1. Postgres only in v0.3.`,
    );
  }
  return db;
}

function chooseDumpPath(opts: RestoreOptions, db: ResolvedPostgresDatabase): string {
  if (opts.file) {
    return resolvePath(expandHome(opts.file));
  }
  const root = expandHome(opts.config.storage.path);
  const dumps = collectDumps(dbRoot(root, db.name));
  if (dumps.length === 0) {
    throw new ConfigError(
      `no dumps found for "${db.name}". Run \`dumpvault run ${db.name}\` first.`,
    );
  }
  dumps.sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (opts.at) {
    const match = findDumpByPrefix(dumps, opts.at);
    if (!match) {
      throw new ConfigError(
        `no dump matching --at "${opts.at}" for "${db.name}". ` +
          `Latest available: ${basename(dumps[0]?.path ?? '')}`,
      );
    }
    return match.path;
  }

  // Default: latest
  const latest = dumps[0];
  if (!latest) throw new ConfigError(`no dumps for "${db.name}"`);
  return latest.path;
}

function validateDumpFormat(path: string): void {
  const fname = basename(path);
  // Accept .dump.gz or .dump.gz.enc (encrypted custom-format).
  if (!(fname.endsWith('.dump.gz') || fname.endsWith('.dump.gz.enc'))) {
    throw new DumpError(
      'restore supports only custom-format Postgres dumps (.dump.gz / .dump.gz.enc). ' +
        'For .sql.gz (plain) or .tar dumps, use the manual recipe in docs/adapters/postgres.md.',
    );
  }
}

interface ResolvedRestoreTarget {
  host: string;
  port: number;
  user: string;
  password: string;
}

function resolveTarget(opts: RestoreOptions, db: ResolvedPostgresDatabase): ResolvedRestoreTarget {
  const host = opts.toHost ?? db.host;
  const port = opts.toPort ?? db.port;
  const user = opts.toUser ?? db.user;

  let password: string;
  if (opts.toPasswordEnv !== undefined) {
    const v = process.env[opts.toPasswordEnv];
    if (v === undefined || v === '') {
      throw new ConfigError(`env var ${opts.toPasswordEnv} for restore target is not set`);
    }
    password = v;
  } else {
    // Reuse the source DB's resolved password (already loaded).
    password = db.password;
    if (!password) {
      throw new ConfigError(
        'no password available for restore target. Provide --to-password-env <var> ' +
          `or set the source DB's password_env so it can be reused.`,
      );
    }
  }

  return { host, port, user, password };
}

async function runPgRestore(
  gzipPath: string,
  pre: NodeJS.ReadWriteStream[],
  target: ResolvedRestoreTarget,
  database: string,
  clean: boolean,
  create: boolean,
  log: Logger,
): Promise<void> {
  const args = [
    '--host',
    target.host,
    '--port',
    String(target.port),
    '--username',
    target.user,
    '--dbname',
    database,
    '--no-password',
  ];
  if (clean) args.push('--clean', '--if-exists');
  if (create) args.push('--create');

  log.info({ command: 'pg_restore', args }, 'streaming dump into pg_restore');

  return new Promise((resolve, reject) => {
    const proc = spawn('pg_restore', args, {
      env: { ...process.env, PGPASSWORD: target.password },
      stdio: ['pipe', 'inherit', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderr += text;
      // Forward warnings to our logger so users see them in real time.
      for (const line of text.split('\n')) {
        if (line.trim()) log.warn({ pg_restore: line.trim() }, 'pg_restore message');
      }
    });

    pipeline(createReadStream(gzipPath), ...pre, createGunzip(), proc.stdin).catch((err) => {
      proc.stdin.destroy();
      reject(new DumpError(`failed to stream dump into pg_restore: ${errMsg(err)}`));
    });

    proc.on('error', (err) =>
      reject(new DumpError(`pg_restore failed to start: ${err.message}`, { cause: err })),
    );
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new DumpError(`pg_restore exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

async function defaultConfirm(summary: RestoreSummary): Promise<boolean> {
  const { confirm } = await import('../util/prompt.ts');
  const lines = [
    '',
    'About to restore from:',
    `  ${summary.source.path}`,
    `  sha256: ${summary.source.sha256}`,
    `  size:   ${humanSize(summary.source.sizeBytes)}`,
    `  dumped: ${summary.source.mtime.toISOString()}`,
    '',
    'To target:',
    `  postgres://${summary.target.user}@${summary.target.host}:${summary.target.port}/${summary.target.database}`,
    '',
    'Modes:',
    `  --clean : ${summary.modes.clean ? 'YES — DROPs existing objects before restore' : 'no'}`,
    `  --create: ${summary.modes.create ? 'YES — CREATEs the target database' : 'no'}`,
    '',
    'This will write data to the target database.',
  ];
  for (const l of lines) console.error(l);
  return await confirm('Continue?');
}

function sha256OfFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
