import { describe, expect, it } from 'bun:test';
import { MysqlAdapter } from '../src/adapters/mysql.ts';
import type { ResolvedMysqlDatabase } from '../src/config/load.ts';

function makeDb(overrides: Partial<ResolvedMysqlDatabase> = {}): ResolvedMysqlDatabase {
  return {
    name: 'test',
    engine: 'mysql',
    host: 'db.example.com',
    port: 3306,
    user: 'backup',
    database: 'app',
    schedule: '@daily',
    password: 'pw',
    options: {
      single_transaction: true,
      routines: true,
      triggers: true,
      events: false,
    },
    ...overrides,
  };
}

describe('MysqlAdapter.buildArgs', () => {
  const fakeDefaults = '/tmp/fake.cnf';

  it('includes defaults file, host/port/user, and database name (last)', () => {
    const args = new MysqlAdapter(makeDb()).buildArgs(fakeDefaults);
    expect(args[0]).toBe(`--defaults-extra-file=${fakeDefaults}`);
    expect(args).toContain('--host');
    expect(args).toContain('db.example.com');
    expect(args).toContain('--port');
    expect(args).toContain('3306');
    expect(args).toContain('--user');
    expect(args).toContain('backup');
    expect(args[args.length - 1]).toBe('app');
  });

  it('emits flags for default-true options', () => {
    const args = new MysqlAdapter(makeDb()).buildArgs(fakeDefaults);
    expect(args).toContain('--single-transaction');
    expect(args).toContain('--routines');
    expect(args).toContain('--triggers');
    expect(args).not.toContain('--events');
  });

  it('omits boolean flags when set false', () => {
    const args = new MysqlAdapter(
      makeDb({
        options: {
          single_transaction: false,
          routines: false,
          triggers: false,
          events: false,
        },
      }),
    ).buildArgs(fakeDefaults);
    expect(args).not.toContain('--single-transaction');
    expect(args).not.toContain('--routines');
    expect(args).not.toContain('--triggers');
  });

  it('emits --events when enabled', () => {
    const args = new MysqlAdapter(
      makeDb({
        options: {
          single_transaction: true,
          routines: true,
          triggers: true,
          events: true,
        },
      }),
    ).buildArgs(fakeDefaults);
    expect(args).toContain('--events');
  });

  it('emits --ssl-mode when configured', () => {
    const args = new MysqlAdapter(
      makeDb({
        options: {
          single_transaction: true,
          routines: true,
          triggers: true,
          events: false,
          ssl_mode: 'REQUIRED',
        },
      }),
    ).buildArgs(fakeDefaults);
    expect(args).toContain('--ssl-mode=REQUIRED');
  });

  it('qualifies excluded tables with the database name', () => {
    const args = new MysqlAdapter(
      makeDb({
        options: {
          single_transaction: true,
          routines: true,
          triggers: true,
          events: false,
          exclude_tables: ['audit_log', 'sessions'],
        },
      }),
    ).buildArgs(fakeDefaults);
    expect(args).toContain('--ignore-table=app.audit_log');
    expect(args).toContain('--ignore-table=app.sessions');
  });

  it('extension is sql', () => {
    expect(new MysqlAdapter(makeDb()).extension()).toBe('sql');
  });

  it('engine is mysql', () => {
    expect(new MysqlAdapter(makeDb()).engine()).toBe('mysql');
  });
});
