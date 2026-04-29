import { describe, expect, it } from 'bun:test';
import { dayBucket, monthBucket, pickKeepers, weekBucket } from '../src/storage/retention.ts';
import type { DumpEntry } from '../src/storage/scan.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Make N dumps spaced one day apart, newest first, anchored at `anchor` (default: 2026-04-29 12:00 UTC). */
function dailyDumps(count: number, anchor = Date.UTC(2026, 3, 29, 12)): DumpEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `/r/db/dump-${i}`,
    mtimeMs: anchor - i * DAY,
    size: 1000,
  }));
}

describe('pickKeepers — keep_last', () => {
  it('keeps the N most recent', () => {
    const dumps = dailyDumps(10);
    const keepers = pickKeepers(dumps, { keep_last: 3 });
    expect(keepers.size).toBe(3);
    expect(keepers.has(dumps[0]?.path ?? '')).toBe(true);
    expect(keepers.has(dumps[1]?.path ?? '')).toBe(true);
    expect(keepers.has(dumps[2]?.path ?? '')).toBe(true);
    expect(keepers.has(dumps[3]?.path ?? '')).toBe(false);
  });

  it('zero or unset means no last-N rule', () => {
    expect(pickKeepers(dailyDumps(5), {}).size).toBe(0);
    expect(pickKeepers(dailyDumps(5), { keep_last: 0 }).size).toBe(0);
  });
});

describe('pickKeepers — keep_daily', () => {
  it('picks the newest dump per day, up to N days', () => {
    const anchor = Date.UTC(2026, 3, 29, 12);
    // 2 dumps on Apr 29, 1 on Apr 28, 1 on Apr 27, 1 on Apr 26
    const dumps: DumpEntry[] = [
      { path: '/r/db/29-12', mtimeMs: anchor, size: 1 },
      { path: '/r/db/29-08', mtimeMs: anchor - 4 * HOUR, size: 1 },
      { path: '/r/db/28-12', mtimeMs: anchor - DAY, size: 1 },
      { path: '/r/db/27-12', mtimeMs: anchor - 2 * DAY, size: 1 },
      { path: '/r/db/26-12', mtimeMs: anchor - 3 * DAY, size: 1 },
    ];
    const keepers = pickKeepers(dumps, { keep_daily: 3 });
    // Newest 3 distinct days are 29, 28, 27 → newest dump from each
    expect(keepers).toEqual(new Set(['/r/db/29-12', '/r/db/28-12', '/r/db/27-12']));
  });
});

describe('pickKeepers — keep_weekly + keep_monthly', () => {
  it('picks newest per ISO week', () => {
    // Two dumps in week 17 (Apr 20-26), two in week 18 (Apr 27-May 3) — newest of each survives
    const dumps: DumpEntry[] = [
      { path: '/r/db/wk18-newer', mtimeMs: Date.UTC(2026, 3, 30, 10), size: 1 },
      { path: '/r/db/wk18-older', mtimeMs: Date.UTC(2026, 3, 27, 10), size: 1 },
      { path: '/r/db/wk17-newer', mtimeMs: Date.UTC(2026, 3, 24, 10), size: 1 },
      { path: '/r/db/wk17-older', mtimeMs: Date.UTC(2026, 3, 20, 10), size: 1 },
    ].sort((a, b) => b.mtimeMs - a.mtimeMs);
    const keepers = pickKeepers(dumps, { keep_weekly: 2 });
    expect(keepers).toEqual(new Set(['/r/db/wk18-newer', '/r/db/wk17-newer']));
  });

  it('picks newest per month', () => {
    const dumps: DumpEntry[] = [
      { path: '/r/db/apr-29', mtimeMs: Date.UTC(2026, 3, 29), size: 1 },
      { path: '/r/db/apr-01', mtimeMs: Date.UTC(2026, 3, 1), size: 1 },
      { path: '/r/db/mar-31', mtimeMs: Date.UTC(2026, 2, 31), size: 1 },
      { path: '/r/db/feb-28', mtimeMs: Date.UTC(2026, 1, 28), size: 1 },
    ].sort((a, b) => b.mtimeMs - a.mtimeMs);
    const keepers = pickKeepers(dumps, { keep_monthly: 2 });
    expect(keepers).toEqual(new Set(['/r/db/apr-29', '/r/db/mar-31']));
  });
});

describe('pickKeepers — combined GFS', () => {
  it('takes the union of all rule selections', () => {
    const dumps = dailyDumps(35); // 35 days of daily dumps, newest first
    const keepers = pickKeepers(dumps, {
      keep_last: 3,
      keep_daily: 7,
      keep_weekly: 4,
    });
    // keep_last=3 → newest 3 daily dumps
    // keep_daily=7 → newest 7 distinct days = newest 7 dumps (all on different days)
    // keep_weekly=4 → newest 4 distinct ISO weeks
    // Union: at least 7 (daily covers last) + a few weekly survivors from older weeks
    expect(keepers.size).toBeGreaterThanOrEqual(7);
    expect(keepers.size).toBeLessThan(35);
    // The 3 newest must be present
    expect(keepers.has(dumps[0]?.path ?? '')).toBe(true);
    expect(keepers.has(dumps[1]?.path ?? '')).toBe(true);
    expect(keepers.has(dumps[2]?.path ?? '')).toBe(true);
  });
});

describe('bucket helpers', () => {
  it('dayBucket formats UTC date with zero-padding', () => {
    expect(dayBucket(new Date('2026-04-29T13:00:00Z'))).toBe('2026-04-29');
    expect(dayBucket(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01-05');
  });

  it('monthBucket formats year + month', () => {
    expect(monthBucket(new Date('2026-04-29T13:00:00Z'))).toBe('2026-04');
  });

  it('weekBucket assigns ISO weeks correctly', () => {
    // 2026-01-05 (Mon) is week 02 of 2026
    expect(weekBucket(new Date('2026-01-05T00:00:00Z'))).toBe('2026-W02');
    // 2026-04-29 (Wed) is week 18
    expect(weekBucket(new Date('2026-04-29T00:00:00Z'))).toBe('2026-W18');
  });
});
