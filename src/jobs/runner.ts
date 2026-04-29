import { join } from 'node:path';
import type { Logger } from 'pino';
import { PostgresAdapter } from '../adapters/postgres.ts';
import { type ResolvedConfig, type ResolvedDatabase, expandHome } from '../config/load.ts';
import { postWebhook } from '../notifications/webhook.ts';
import { dbRoot, dumpDir, dumpFilename } from '../storage/paths.ts';
import { pruneKeepLast } from '../storage/retention.ts';
import { type WriteResult, writeDump } from '../storage/writer.ts';
import { errMsg, humanSize } from '../util/format.ts';

export async function runJob(
  db: ResolvedDatabase,
  config: ResolvedConfig,
  log: Logger,
): Promise<WriteResult> {
  const jobLog = log.child({ db: db.name, engine: db.engine });
  jobLog.info('job start');

  const adapter = new PostgresAdapter(db);
  await adapter.preflight();

  const root = expandHome(config.storage.path);
  const now = new Date();
  const dir = dumpDir(root, db.name, now);
  const filename = dumpFilename(now, `${adapter.extension()}.gz`);
  const outputPath = join(dir, filename);

  jobLog.info({ outputPath }, 'writing dump');

  const result = await writeDump(adapter, outputPath);

  jobLog.info(
    {
      outputPath: result.outputPath,
      bytes: result.bytes,
      sha256: result.sha256,
      durationMs: result.durationMs,
    },
    'dump complete',
  );

  pruneKeepLast(dbRoot(root, db.name), config.storage.retention.keep_last, jobLog);

  jobLog.info('job complete');
  return result;
}

/**
 * Wraps `runJob` with optional webhook notifications per the config.
 * Notification delivery failures are logged as warnings but do not fail the job.
 */
export async function runJobWithNotifications(
  db: ResolvedDatabase,
  config: ResolvedConfig,
  log: Logger,
): Promise<void> {
  const notif = config.notifications;
  let result: WriteResult;
  try {
    result = await runJob(db, config, log);
  } catch (err) {
    if (notif?.on.includes('failure')) {
      const msg = errMsg(err);
      await postWebhook(
        notif.webhook,
        {
          event: 'dump.failure',
          tool: 'dumpvault',
          db: db.name,
          engine: db.engine,
          timestamp: new Date().toISOString(),
          error: msg,
          text: `DumpVault: dump.failure for "${db.name}" (${db.engine}) — ${msg}`,
        },
        log,
      );
    }
    throw err;
  }

  if (notif?.on.includes('success')) {
    await postWebhook(
      notif.webhook,
      {
        event: 'dump.success',
        tool: 'dumpvault',
        db: db.name,
        engine: db.engine,
        timestamp: new Date().toISOString(),
        duration_ms: result.durationMs,
        bytes: result.bytes,
        sha256: result.sha256,
        output_path: result.outputPath,
        text: `DumpVault: dump.success for "${db.name}" (${db.engine}) — ${humanSize(result.bytes)} in ${(result.durationMs / 1000).toFixed(1)}s`,
      },
      log,
    );
  }
}
