import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface DumpEntry {
  path: string;
  mtimeMs: number;
  size: number;
}

export function collectDumps(dbDir: string): DumpEntry[] {
  if (!existsSync(dbDir)) return [];
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
            if (st.isFile()) out.push({ path: fPath, mtimeMs: st.mtimeMs, size: st.size });
          } catch {
            // skip unreadable file
          }
        }
      }
    }
  }
  return out;
}

export function readSha256Sidecar(dumpPath: string): string | null {
  try {
    const content = readFileSync(`${dumpPath}.sha256`, 'utf8');
    const first = content.trim().split(/\s+/)[0];
    return first ?? null;
  } catch {
    return null;
  }
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
