import { describe, expect, it } from 'bun:test';
import { findDumpByPrefix } from '../src/jobs/restore.ts';
import type { DumpEntry } from '../src/storage/scan.ts';

function makeDumps(filenames: string[]): DumpEntry[] {
  // newest-first as restore expects
  return filenames.map((f, i) => ({
    path: `/backups/db/2026/04/29/${f}`,
    mtimeMs: 1_000_000 - i,
    size: 1000,
  }));
}

describe('findDumpByPrefix', () => {
  const dumps = makeDumps([
    '2026-04-29T13-31-37Z.dump.gz',
    '2026-04-29T13-31-20Z.dump.gz',
    '2026-04-28T02-00-00Z.dump.gz',
    '2026-04-27T02-00-00Z.dump.gz',
  ]);

  it('matches an exact ISO timestamp (with colons normalized)', () => {
    const m = findDumpByPrefix(dumps, '2026-04-29T13:31:37Z');
    expect(m?.path).toContain('2026-04-29T13-31-37Z');
  });

  it('matches the newest dump on a given day with a date-only prefix', () => {
    const m = findDumpByPrefix(dumps, '2026-04-29');
    // dumps are newest-first, so the first hit on 2026-04-29 is 13-31-37Z
    expect(m?.path).toContain('2026-04-29T13-31-37Z');
  });

  it('matches the newest dump in a given hour', () => {
    const m = findDumpByPrefix(dumps, '2026-04-29T13');
    expect(m?.path).toContain('2026-04-29T13-31-37Z');
  });

  it('returns null when nothing matches', () => {
    const m = findDumpByPrefix(dumps, '2025-01-01');
    expect(m).toBeNull();
  });

  it('accepts dashes already in place (no double-conversion)', () => {
    const m = findDumpByPrefix(dumps, '2026-04-28T02-00-00Z');
    expect(m?.path).toContain('2026-04-28T02-00-00Z');
  });
});
