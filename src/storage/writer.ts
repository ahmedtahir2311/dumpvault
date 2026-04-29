import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import type { Adapter } from '../adapters/adapter.ts';
import { StorageError } from '../errors.ts';
import { Encryptor } from './encryption.ts';

export interface WriteResult {
  outputPath: string;
  bytes: number;
  sha256: string;
  durationMs: number;
}

export interface WriteOptions {
  /** When set, the gzipped stream is AES-256-GCM encrypted before hitting disk. */
  encryptionKey?: Buffer;
}

export async function writeDump(
  adapter: Adapter,
  outputPath: string,
  opts: WriteOptions = {},
): Promise<WriteResult> {
  try {
    mkdirSync(dirname(outputPath), { recursive: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new StorageError(`could not create dir ${dirname(outputPath)}: ${msg}`);
  }

  const tmpPath = `${outputPath}.tmp`;
  const start = Date.now();
  const hash = createHash('sha256');
  let bytes = 0;

  const raw = new PassThrough();
  const gz = createGzip();
  const tap = new PassThrough();
  tap.on('data', (chunk: Buffer) => {
    hash.update(chunk);
    bytes += chunk.length;
  });
  const file = createWriteStream(tmpPath);

  const dumpPromise = adapter.dump(raw).catch((err) => {
    raw.destroy(err instanceof Error ? err : new Error(String(err)));
    throw err;
  });

  try {
    const pipePromise = opts.encryptionKey
      ? pipeline(raw, gz, new Encryptor(opts.encryptionKey), tap, file)
      : pipeline(raw, gz, tap, file);
    await Promise.all([dumpPromise, pipePromise]);
    renameSync(tmpPath, outputPath);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore — tmp may not exist or already cleaned up
    }
    throw err;
  }

  const sha256 = hash.digest('hex');
  try {
    writeFileSync(`${outputPath}.sha256`, `${sha256}  ${basename(outputPath)}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new StorageError(`could not write sha256 sidecar for ${outputPath}: ${msg}`);
  }

  return {
    outputPath,
    bytes,
    sha256,
    durationMs: Date.now() - start,
  };
}
