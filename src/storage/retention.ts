import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';

interface DumpEntry {
  path: string;
  mtimeMs: number;
}

export function pruneKeepLast(dbDir: string, keepLast: number, log: Logger): void {
  if (!existsSync(dbDir)) return;
  if (keepLast < 1) return;

  const dumps = collectDumps(dbDir);
  dumps.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const toDelete = dumps.slice(keepLast);
  for (const entry of toDelete) {
    try {
      unlinkSync(entry.path);
      try {
        unlinkSync(`${entry.path}.sha256`);
      } catch {
        // sidecar may not exist for legacy dumps
      }
      log.info({ path: entry.path }, 'pruned old dump');
    } catch (err) {
      log.warn({ path: entry.path, err: errMsg(err) }, 'failed to prune dump');
    }
  }
}

function collectDumps(dbDir: string): DumpEntry[] {
  const out: DumpEntry[] = [];
  for (const year of safeReaddir(dbDir)) {
    const yPath = join(dbDir, year);
    if (!isDir(yPath)) continue;
    for (const month of safeReaddir(yPath)) {
      const mPath = join(yPath, month);
      if (!isDir(mPath)) continue;
      for (const day of safeReaddir(mPath)) {
        const dPath = join(mPath, day);
        if (!isDir(dPath)) continue;
        for (const file of safeReaddir(dPath)) {
          if (file.endsWith('.sha256') || file.endsWith('.tmp')) continue;
          const fPath = join(dPath, file);
          try {
            const st = statSync(fPath);
            if (st.isFile()) out.push({ path: fPath, mtimeMs: st.mtimeMs });
          } catch {
            // ignore unreadable file
          }
        }
      }
    }
  }
  return out;
}

function safeReaddir(p: string): string[] {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
