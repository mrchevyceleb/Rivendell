// Tombstone, not a real worker. Rivendell used to ship a PWA-only service
// worker whose `fetch` handler was a pass-through no-op, which browsers flag as
// dead weight on every navigation. Nothing registers a service worker any more.
//
// A browser that already installed the old one only drops it after fetching
// THIS url and finding a different, valid script. With the file gone the SPA
// fallback answered /sw.js with index.html (200, text/html) - an invalid worker
// script, so the update check failed and the stale worker stayed installed for
// good. So hand back a real worker whose only job is to remove itself.
//
// Deliberately no `fetch` listener: that is what made the old one a no-op.

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
    })(),
  );
});
