import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import type { Logger } from 'pino';
import { type ResolvedConfig, expandHome } from '../config/load.ts';
import { Decryptor, isEncryptedPath } from '../storage/encryption.ts';
import { dbRoot } from '../storage/paths.ts';
import { collectDumps, readSha256Sidecar } from '../storage/scan.ts';
import { errMsg } from '../util/format.ts';

export interface VerifyResult {
  path: string;
  sha256Expected: string | null;
  sha256Actual: string;
  shaOk: boolean;
  gunzipOk: boolean;
  pgRestoreOk: boolean | null;
  ok: boolean;
  errors: string[];
}

export interface VerifyOptions {
  config: ResolvedConfig;
  /** If set, only verify dumps for this DB. Else: all configured DBs. */
  dbName?: string;
  /** If false (default), only the latest dump per DB. If true, every dump. */
  all: boolean;
  /** Verify a specific file directly. Overrides dbName / all. */
  file?: string;
}

/** Resolve the right transform stack for a given dump path. */
function preGunzipTransforms(path: string, key?: Buffer): NodeJS.ReadWriteStream[] {
  if (!isEncryptedPath(path)) return [];
  if (!key) {
    throw new Error(
      `${path} is encrypted but no encryption key is configured. Set storage.encryption in your config (or pass --no-config and decrypt manually).`,
    );
  }
  return [new Decryptor(key)];
}

export async function runVerify(opts: VerifyOptions, log: Logger): Promise<VerifyResult[]> {
  const targets = collectTargets(opts);
  if (targets.length === 0) {
    log.warn('no dumps found to verify');
    return [];
  }

  const results: VerifyResult[] = [];
  for (const path of targets) {
    log.info({ path }, 'verifying');
    const result = await verifyOne(path, opts.config.encryptionKey);
    results.push(result);
    if (result.ok) {
      log.info({ path, sha256: result.sha256Actual }, 'verify ok');
    } else {
      log.error({ path, errors: result.errors }, 'verify failed');
    }
  }
  return results;
}

function collectTargets(opts: VerifyOptions): string[] {
  if (opts.file) return [opts.file];

  const root = expandHome(opts.config.storage.path);
  const dbs = opts.dbName
    ? opts.config.databases.filter((d) => d.name === opts.dbName)
    : opts.config.databases;

  const out: string[] = [];
  for (const db of dbs) {
    const dumps = collectDumps(dbRoot(root, db.name));
    dumps.sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (opts.all) {
      for (const d of dumps) out.push(d.path);
    } else if (dumps[0]) {
      out.push(dumps[0].path);
    }
  }
  return out;
}

async function verifyOne(path: string, key?: Buffer): Promise<VerifyResult> {
  const errors: string[] = [];
  const expected = readSha256Sidecar(path);
  const actual = await sha256OfFile(path);
  const shaOk = expected !== null && expected.toLowerCase() === actual.toLowerCase();
  if (expected === null) errors.push('sha256 sidecar missing');
  else if (!shaOk) errors.push(`sha256 mismatch (expected ${expected}, got ${actual})`);

  let pre: NodeJS.ReadWriteStream[];
  try {
    pre = preGunzipTransforms(path, key);
  } catch (err) {
    errors.push(errMsg(err));
    return {
      path,
      sha256Expected: expected,
      sha256Actual: actual,
      shaOk,
      gunzipOk: false,
      pgRestoreOk: null,
      ok: false,
      errors,
    };
  }

  const gunzipOk = await gunzipIntegrityOk(path, pre);
  if (!gunzipOk) {
    errors.push(
      isEncryptedPath(path)
        ? 'decryption or gunzip failed (file may be tampered, corrupt, or the key is wrong)'
        : 'gunzip decompression failed (file may be truncated or corrupt)',
    );
  }

  let pgRestoreOk: boolean | null = null;
  if (basename(path).includes('.dump.gz') && gunzipOk) {
    pgRestoreOk = await pgRestoreReadable(path, key);
    if (pgRestoreOk === false) {
      errors.push('pg_restore -l could not read the archive');
    }
  }

  return {
    path,
    sha256Expected: expected,
    sha256Actual: actual,
    shaOk,
    gunzipOk,
    pgRestoreOk,
    ok: errors.length === 0,
    errors,
  };
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

function discardSink(): Writable {
  return new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
}

async function gunzipIntegrityOk(path: string, pre: NodeJS.ReadWriteStream[]): Promise<boolean> {
  try {
    await pipeline(createReadStream(path), ...pre, createGunzip(), discardSink());
    return true;
  } catch {
    return false;
  }
}

async function pgRestoreReadable(gzipPath: string, key?: Buffer): Promise<boolean> {
  let pre: NodeJS.ReadWriteStream[];
  try {
    pre = preGunzipTransforms(gzipPath, key);
  } catch {
    return false;
  }

  return new Promise((resolve) => {
    const proc = spawn('pg_restore', ['-l'], { stdio: ['pipe', 'ignore', 'pipe'] });

    let failed = false;
    pipeline(createReadStream(gzipPath), ...pre, createGunzip(), proc.stdin).catch(() => {
      failed = true;
      proc.stdin.destroy();
    });

    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(!failed && code === 0));
  });
}
