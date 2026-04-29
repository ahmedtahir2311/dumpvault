import type { Logger } from 'pino';

type Task = () => Promise<void>;

interface PendingJob {
  db: string;
  task: Task;
}

/**
 * Per-DB serialized, globally capped job queue.
 *
 * - At most `maxConcurrent` jobs run in parallel.
 * - A job for a database that is currently running OR queued is rejected (overlap-skip).
 * - This implements PRD §6.2's overlap policy: skip + log + wait for next tick.
 */
export class JobQueue {
  private readonly runningDbs = new Set<string>();
  private active = 0;
  private readonly pending: PendingJob[] = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly log: Logger,
  ) {
    if (maxConcurrent < 1) throw new Error('maxConcurrent must be >= 1');
  }

  /** Returns true if accepted, false if skipped because the same DB has a job in flight or queued. */
  submit(db: string, task: Task): boolean {
    if (this.runningDbs.has(db) || this.pending.some((p) => p.db === db)) {
      this.log.warn(
        { db },
        'overlap-skip — previous run for this database still in flight or queued',
      );
      return false;
    }
    this.pending.push({ db, task });
    this.tick();
    return true;
  }

  inflightCount(): number {
    return this.active;
  }

  pendingCount(): number {
    return this.pending.length;
  }

  hasInflight(): boolean {
    return this.active > 0 || this.pending.length > 0;
  }

  /** Wait until queue is empty or `timeoutMs` elapses. */
  async drain(timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (this.hasInflight()) {
      if (Date.now() - start > timeoutMs) {
        this.log.warn(
          { active: this.active, pending: this.pending.length },
          'drain timeout — exiting with jobs still running',
        );
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private tick(): void {
    while (this.active < this.maxConcurrent && this.pending.length > 0) {
      const next = this.pending.shift();
      if (!next) break;
      void this.runOne(next);
    }
  }

  private async runOne(item: PendingJob): Promise<void> {
    this.runningDbs.add(item.db);
    this.active++;
    try {
      await item.task();
    } finally {
      this.runningDbs.delete(item.db);
      this.active--;
      this.tick();
    }
  }
}
