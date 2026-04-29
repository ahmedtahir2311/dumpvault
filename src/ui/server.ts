import type { Logger } from 'pino';
import type { ResolvedConfig } from '../config/load.ts';
import { createApiApp } from './api.ts';
// Bun's HTML import — bundles the React SPA + CSS at build time and embeds in the binary.
import indexHtml from './frontend/index.html';

export interface WebUIOptions {
  config: ResolvedConfig;
  log: Logger;
  port: number;
  /** Default 127.0.0.1 — keep localhost-only unless explicitly opened. */
  host?: string;
}

export interface WebUIServer {
  url: string;
  stop: () => void;
}

export function startWebUI(opts: WebUIOptions): WebUIServer {
  const apiApp = createApiApp(opts.config, opts.log);
  const host = opts.host ?? '127.0.0.1';

  const server = Bun.serve({
    port: opts.port,
    hostname: host,
    routes: {
      // Serve the bundled SPA at root and any client-side route.
      // biome-ignore lint/suspicious/noExplicitAny: Bun's HTMLBundle import type
      '/': indexHtml as any,
      // biome-ignore lint/suspicious/noExplicitAny: Bun's HTMLBundle import type
      '/db/:name': indexHtml as any,
      // Hono handles the API surface.
      '/api/*': (req: Request) => apiApp.fetch(req),
    },
    fetch(req: Request) {
      // Catch-all fallback — let Hono respond with 404 JSON for unknown paths.
      return apiApp.fetch(req);
    },
  });

  const url = `http://${host}:${server.port}`;
  opts.log.info({ url }, 'web UI listening');

  if (host !== '127.0.0.1' && host !== 'localhost') {
    opts.log.warn(
      { host },
      'web UI is binding to a non-localhost address — there is no auth in v0.5. Use SSH tunneling for remote access.',
    );
  }

  return {
    url,
    stop: () => {
      server.stop();
      opts.log.info('web UI stopped');
    },
  };
}
