import { join } from 'node:path';
import type { Logger } from 'pino';
import { PostgresAdapter } from '../adapters/postgres.ts';
import { expandHome, type ResolvedConfig, type ResolvedDatabase } from '../config/load.ts';
import { dbRoot, dumpDir, dumpFilename } from '../storage/paths.ts';
import { pruneKeepLast } from '../storage/retention.ts';
import { writeDump } from '../storage/writer.ts';

export async function runJob(
  db: ResolvedDatabase,
  config: ResolvedConfig,
  log: Logger,
): Promise<void> {
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
}
