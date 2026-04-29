import { unlinkSync } from 'node:fs';
import type { Logger } from 'pino';
import { errMsg } from '../util/format.ts';
import { type DumpEntry, collectDumps } from './scan.ts';

export interface RetentionPolicy {
  keep_last?: number | undefined;
  keep_daily?: number | undefined;
  keep_weekly?: number | undefined;
  keep_monthly?: number | undefined;
}

export function pruneByPolicy(dbDir: string, policy: RetentionPolicy, log: Logger): void {
  const dumps = collectDumps(dbDir);
  if (dumps.length === 0) return;

  // newest first — required for the bucketing rules below
  const sorted = [...dumps].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const keepers = pickKeepers(sorted, policy);

  for (const entry of sorted) {
    if (keepers.has(entry.path)) continue;
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

/**
 * Compute the union of keepers across all four GFS rules.
 * Exported for testing.
 *
 * @param sorted  dumps sorted newest-first
 */
export function pickKeepers(sorted: DumpEntry[], policy: RetentionPolicy): Set<string> {
  const keepers = new Set<string>();

  if (policy.keep_last && policy.keep_last > 0) {
    for (const d of sorted.slice(0, policy.keep_last)) {
      keepers.add(d.path);
    }
  }

  pickBucketed(sorted, policy.keep_daily, dayBucket, keepers);
  pickBucketed(sorted, policy.keep_weekly, weekBucket, keepers);
  pickBucketed(sorted, policy.keep_monthly, monthBucket, keepers);

  return keepers;
}

function pickBucketed(
  sorted: DumpEntry[],
  count: number | undefined,
  bucketFn: (d: Date) => string,
  keepers: Set<string>,
): void {
  if (!count || count <= 0) return;
  const seen = new Set<string>();
  for (const entry of sorted) {
    if (seen.size >= count) break;
    const key = bucketFn(new Date(entry.mtimeMs));
    if (seen.has(key)) continue;
    seen.add(key);
    keepers.add(entry.path);
  }
}

export function dayBucket(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function monthBucket(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

/** ISO-8601 week (compatible with `date '+%G-W%V'`). */
export function weekBucket(d: Date): string {
  // ISO week starts on Monday; day 1=Monday, 7=Sunday.
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = target.getUTCDay() || 7; // Sunday = 7
  target.setUTCDate(target.getUTCDate() + 4 - dayNum); // Thursday of this week
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${pad2(weekNo)}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
