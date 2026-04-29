import { describe, expect, it } from 'bun:test';
import { JobQueue } from '../src/scheduler/queue.ts';

const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLog,
  level: 'silent',
} as never;

describe('JobQueue', () => {
  it('accepts the first job for a DB and skips the second', () => {
    const q = new JobQueue(2, silentLog);
    const accepted1 = q.submit('db-a', () => new Promise(() => {})); // never resolves
    const accepted2 = q.submit('db-a', () => new Promise(() => {}));
    expect(accepted1).toBe(true);
    expect(accepted2).toBe(false);
  });

  it('allows different DBs to run concurrently', () => {
    const q = new JobQueue(2, silentLog);
    const a = q.submit('db-a', () => new Promise(() => {}));
    const b = q.submit('db-b', () => new Promise(() => {}));
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(q.inflightCount()).toBe(2);
  });

  it('queues jobs over max_concurrent and runs them as slots free up', async () => {
    const q = new JobQueue(1, silentLog);
    const order: string[] = [];

    const a = q.submit('db-a', async () => {
      order.push('a-start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('a-end');
    });
    const b = q.submit('db-b', async () => {
      order.push('b-start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('b-end');
    });

    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(q.pendingCount()).toBe(1);

    await q.drain(2000);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('drain returns promptly when queue is empty', async () => {
    const q = new JobQueue(2, silentLog);
    const start = Date.now();
    await q.drain(1000);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('rejects maxConcurrent < 1', () => {
    expect(() => new JobQueue(0, silentLog)).toThrow();
  });
});
