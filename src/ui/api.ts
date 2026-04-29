import { Cron } from 'croner';
import { Hono } from 'hono';
import type { Logger } from 'pino';
import { type ResolvedConfig, expandHome } from '../config/load.ts';
import { runJobWithNotifications } from '../jobs/runner.ts';
import { runVerify } from '../jobs/verify.ts';
import { dbRoot } from '../storage/paths.ts';
import { collectDumps, readSha256Sidecar } from '../storage/scan.ts';
import { errMsg } from '../util/format.ts';

export function createApiApp(config: ResolvedConfig, log: Logger): Hono {
  const app = new Hono();

  app.get('/api/databases', (c) => {
    return c.json(
      config.databases.map((db) => ({
        name: db.name,
        engine: db.engine,
        host: db.host,
        port: db.port,
        database: db.database,
        schedule: db.schedule,
      })),
    );
  });

  app.get('/api/status', (c) => {
    const root = expandHome(config.storage.path);
    const rows = config.databases.map((db) => {
      const dumps = collectDumps(dbRoot(root, db.name));
      dumps.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const last = dumps[0];
      let nextRun: string | null = null;
      try {
        nextRun = new Cron(db.schedule, { paused: true }).nextRun()?.toISOString() ?? null;
      } catch {
        nextRun = null;
      }
      return {
        name: db.name,
        engine: db.engine,
        schedule: db.schedule,
        encrypted: Boolean(config.encryptionKey),
        lastDump: last
          ? {
              path: last.path,
              mtime: new Date(last.mtimeMs).toISOString(),
              size: last.size,
            }
          : null,
        nextRun,
      };
    });
    return c.json(rows);
  });

  app.get('/api/history/:name', (c) => {
    const name = c.req.param('name');
    const db = config.databases.find((d) => d.name === name);
    if (!db) return c.json({ error: `database "${name}" not found` }, 404);

    const root = expandHome(config.storage.path);
    const dumps = collectDumps(dbRoot(root, db.name));
    dumps.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return c.json(
      dumps.map((d) => ({
        path: d.path,
        timestamp: new Date(d.mtimeMs).toISOString(),
        size: d.size,
        sha256: readSha256Sidecar(d.path),
      })),
    );
  });

  app.post('/api/run/:name', async (c) => {
    const name = c.req.param('name');
    const db = config.databases.find((d) => d.name === name);
    if (!db) return c.json({ error: `database "${name}" not found` }, 404);
    if (!db.password) {
      return c.json(
        {
          error: `password not resolved for "${name}". Restart the daemon with the relevant env vars set, or set storage.encryption.key_file.`,
        },
        400,
      );
    }

    log.info({ db: name, source: 'web-ui' }, 'run-now triggered from web UI');
    try {
      await runJobWithNotifications(db, config, log);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: errMsg(err) }, 500);
    }
  });

  app.post('/api/verify/:name', async (c) => {
    const name = c.req.param('name');
    const db = config.databases.find((d) => d.name === name);
    if (!db) return c.json({ error: `database "${name}" not found` }, 404);

    try {
      const results = await runVerify({ config, dbName: name, all: false }, log);
      return c.json(results);
    } catch (err) {
      return c.json({ error: errMsg(err) }, 500);
    }
  });

  return app;
}
