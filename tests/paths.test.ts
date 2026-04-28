import { describe, expect, it } from 'bun:test';
import { dbRoot, dumpDir, dumpFilename } from '../src/storage/paths.ts';

describe('dumpDir', () => {
  it('formats UTC date components with zero-padding', () => {
    const when = new Date('2026-04-28T02:00:00.000Z');
    expect(dumpDir('/backups', 'prod', when)).toBe('/backups/prod/2026/04/28');
  });

  it('handles January (single-digit month) with leading zero', () => {
    const when = new Date('2026-01-05T12:00:00.000Z');
    expect(dumpDir('/r', 'db', when)).toBe('/r/db/2026/01/05');
  });
});

describe('dumpFilename', () => {
  it('produces a filesystem-safe ISO-like timestamp', () => {
    const when = new Date('2026-04-28T02:00:00.000Z');
    expect(dumpFilename(when, 'dump.gz')).toBe('2026-04-28T02-00-00Z.dump.gz');
  });

  it('strips milliseconds', () => {
    const when = new Date('2026-04-28T02:00:00.123Z');
    expect(dumpFilename(when, 'sql.gz')).toBe('2026-04-28T02-00-00Z.sql.gz');
  });
});

describe('dbRoot', () => {
  it('joins root and db name', () => {
    expect(dbRoot('/backups', 'prod-app')).toBe('/backups/prod-app');
  });
});
