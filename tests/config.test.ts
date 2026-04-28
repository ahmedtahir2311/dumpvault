import { describe, expect, it } from 'bun:test';
import { ConfigSchema } from '../src/config/schema.ts';

const baseDb = {
  name: 'prod',
  engine: 'postgres',
  host: 'db',
  user: 'u',
  database: 'app',
  schedule: '0 2 * * *',
  password_env: 'PG_PW',
};

const baseConfig = {
  storage: { path: '/tmp/b', retention: { keep_last: 7 } },
  databases: [baseDb],
};

describe('ConfigSchema', () => {
  it('accepts a minimal valid config', () => {
    const r = ConfigSchema.safeParse(baseConfig);
    expect(r.success).toBe(true);
  });

  it('rejects inline password (unknown key under strict mode)', () => {
    const r = ConfigSchema.safeParse({
      ...baseConfig,
      databases: [{ ...baseDb, password_env: undefined, password: 'secret' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects when neither password_env nor password_file is set', () => {
    const { password_env: _, ...db } = baseDb;
    const r = ConfigSchema.safeParse({ ...baseConfig, databases: [db] });
    expect(r.success).toBe(false);
  });

  it('rejects when both password_env AND password_file are set', () => {
    const r = ConfigSchema.safeParse({
      ...baseConfig,
      databases: [{ ...baseDb, password_file: '/etc/pw' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects duplicate database names', () => {
    const r = ConfigSchema.safeParse({
      ...baseConfig,
      databases: [baseDb, { ...baseDb, host: 'other' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects invalid database name characters', () => {
    const r = ConfigSchema.safeParse({
      ...baseConfig,
      databases: [{ ...baseDb, name: 'has spaces' }],
    });
    expect(r.success).toBe(false);
  });

  it('applies default scheduler values', () => {
    const r = ConfigSchema.parse(baseConfig);
    expect(r.scheduler.max_concurrent).toBe(2);
    expect(r.scheduler.jitter_seconds).toBe(0);
  });

  it('applies default postgres options', () => {
    const r = ConfigSchema.parse(baseConfig);
    expect(r.databases[0]?.options.format).toBe('custom');
    expect(r.databases[0]?.options.compress).toBe(6);
  });
});
