import { join } from 'node:path';

export function dumpDir(root: string, dbName: string, when: Date): string {
  const yyyy = String(when.getUTCFullYear());
  const mm = String(when.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(when.getUTCDate()).padStart(2, '0');
  return join(root, dbName, yyyy, mm, dd);
}

export function dumpFilename(when: Date, ext: string): string {
  // 2026-04-28T02:00:00.000Z → 2026-04-28T02-00-00Z
  const iso = when.toISOString();
  const stamp = `${iso.slice(0, 19).replace(/:/g, '-')}Z`;
  return `${stamp}.${ext}`;
}

export function dbRoot(root: string, dbName: string): string {
  return join(root, dbName);
}
