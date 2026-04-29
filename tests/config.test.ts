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
    const db = r.databases[0];
    expect(db?.engine).toBe('postgres');
    if (db?.engine === 'postgres') {
      expect(db.options.format).toBe('custom');
      expect(db.options.compress).toBe(6);
    }
  });

  it('accepts a valid mysql database', () => {
    const r = ConfigSchema.safeParse({
      ...baseConfig,
      databases: [{ ...baseDb, engine: 'mysql' }],
    });
    expect(r.success).toBe(true);
  });

  it('applies engine-specific port defaults (5432 for postgres, 3306 for mysql)', () => {
    const r = ConfigSchema.parse({
      ...baseConfig,
      databases: [
        { ...baseDb, name: 'pg' },
        { ...baseDb, name: 'my', engine: 'mysql' },
      ],
    });
    expect(r.databases[0]?.port).toBe(5432);
    expect(r.databases[1]?.port).toBe(3306);
  });

  it('applies mysql option defaults (single_transaction, routines, triggers)', () => {
    const r = ConfigSchema.parse({
      ...baseConfig,
      databases: [{ ...baseDb, engine: 'mysql' }],
    });
    const db = r.databases[0];
    if (db?.engine === 'mysql') {
      expect(db.options.single_transaction).toBe(true);
      expect(db.options.routines).toBe(true);
      expect(db.options.triggers).toBe(true);
      expect(db.options.events).toBe(false);
    }
  });

  it('rejects an unknown engine', () => {
    const r = ConfigSchema.safeParse({
      ...baseConfig,
      databases: [{ ...baseDb, engine: 'sqlite' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects postgres options on a mysql database', () => {
    const r = ConfigSchema.safeParse({
      ...baseConfig,
      databases: [{ ...baseDb, engine: 'mysql', options: { format: 'custom' } }],
    });
    expect(r.success).toBe(false);
  });
});
