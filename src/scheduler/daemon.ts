import { Cron } from 'croner';
import type { Logger } from 'pino';
import type { ResolvedConfig, ResolvedDatabase } from '../config/load.ts';
import { runJobWithNotifications } from '../jobs/runner.ts';
import { errMsg } from '../util/format.ts';
import { JobQueue } from './queue.ts';

export class Daemon {
  private readonly cronJobs: Cron[] = [];
  private readonly queue: JobQueue;
  private stopping = false;

  constructor(
    private readonly config: ResolvedConfig,
    private readonly log: Logger,
  ) {
    this.queue = new JobQueue(config.scheduler.max_concurrent, log);
  }

  start(): void {
    this.log.info(
      {
        databases: this.config.databases.length,
        max_concurrent: this.config.scheduler.max_concurrent,
        jitter_seconds: this.config.scheduler.jitter_seconds,
      },
      'daemon starting',
    );

    for (const db of this.config.databases) {
      const cron = new Cron(db.schedule, { name: db.name }, () => this.fireJob(db));
      this.cronJobs.push(cron);
      this.log.info(
        {
          db: db.name,
          schedule: db.schedule,
          nextRun: cron.nextRun()?.toISOString() ?? null,
        },
        'job registered',
      );
    }

    this.log.info('daemon ready');
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.log.info('shutdown — stopping schedules');
    for (const c of this.cronJobs) c.stop();
    this.log.info({ inflight: this.queue.inflightCount() }, 'waiting for in-flight jobs');
    await this.queue.drain(60_000);
    this.log.info('daemon stopped');
  }

  private fireJob(db: ResolvedDatabase): void {
    if (this.stopping) return;
    const jitter = this.config.scheduler.jitter_seconds;
    const delayMs = jitter > 0 ? Math.floor(Math.random() * jitter * 1000) : 0;

    setTimeout(() => {
      if (this.stopping) return;
      this.queue.submit(db.name, async () => {
        try {
          await runJobWithNotifications(db, this.config, this.log);
        } catch (err) {
          this.log.error({ db: db.name, err: errMsg(err) }, 'job failed');
        }
      });
    }, delayMs);
  }
}
