/**
 * PWA assets served from Hono routes — manifest, icon, service worker.
 *
 * These are embedded as string constants rather than bundled by Bun's HTML
 * import because:
 *   1. The service worker must be served at a stable path (`/sw.js`) for its
 *      scope to cover the whole app — Bun's bundler hashes asset paths.
 *   2. The manifest's `icons[].src` and `start_url` need to be predictable.
 *
 * Footprint: ~1.5KB total in the compiled binary.
 */

export const MANIFEST = JSON.stringify({
  name: 'DumpVault',
  short_name: 'DumpVault',
  description: 'Cross-engine database backup tool',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  display_override: ['window-controls-overlay', 'standalone'],
  orientation: 'any',
  background_color: '#0d1117',
  theme_color: '#0d1117',
  categories: ['developer', 'utilities', 'productivity'],
  icons: [
    {
      src: '/icon.svg',
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any maskable',
    },
  ],
});

export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0d1117"/>
  <rect x="80" y="80" width="352" height="352" rx="40" fill="none" stroke="#58a6ff" stroke-width="14"/>
  <text x="256" y="328" font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, sans-serif" font-weight="800" font-size="200" fill="#58a6ff" text-anchor="middle" letter-spacing="-8">DV</text>
</svg>
`;

/**
 * Minimal service worker. Registers a fetch handler so the browser recognizes
 * this as a PWA-installable app, but does not cache anything — the daemon
 * must be running for the UI to be useful, so offline support adds zero value.
 */
export const SERVICE_WORKER = `// DumpVault PWA service worker — pass-through, no caching.
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Pass through to the network. We do not cache — the daemon must be
  // reachable for the UI to function, so cached views would be misleading.
});
`;
