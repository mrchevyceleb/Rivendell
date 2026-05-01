// Minimal service worker. Its job is to make Rivendell installable as a
// PWA. We deliberately do NOT cache API responses, WebSocket traffic, or
// the SPA shell, because the app is always-on inside the tailnet and
// stale dashboard data would be misleading.

const VERSION = 'rivendell-sw-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', () => {
  // Pass-through: let the network handle every request. The SW only
  // exists so browsers offer the install prompt.
});
