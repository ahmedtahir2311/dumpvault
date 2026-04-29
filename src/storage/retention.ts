import { unlinkSync } from 'node:fs';
import type { Logger } from 'pino';
import { errMsg } from '../util/format.ts';
import { collectDumps } from './scan.ts';

export function pruneKeepLast(dbDir: string, keepLast: number, log: Logger): void {
  if (keepLast < 1) return;

  const dumps = collectDumps(dbDir);
  dumps.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const entry of dumps.slice(keepLast)) {
    try {
      unlinkSync(entry.path);
      try {
        unlinkSync(`${entry.path}.sha256`);
      } catch {
        // sidecar may not exist
      }
      log.info({ path: entry.path }, 'pruned old dump');
    } catch (err) {
      log.warn({ path: entry.path, err: errMsg(err) }, 'failed to prune dump');
    }
  }
}
