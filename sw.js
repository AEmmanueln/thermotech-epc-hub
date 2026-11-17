
/* Thermotech EPC Operations Hub — service worker
 * NETWORK-FIRST for EVERYTHING on this origin (the app shell AND the hashed
 * build assets). The cache is only ever a fallback for when the device is
 * offline. This is a deliberate change from the old "stale-while-revalidate"
 * behaviour, which could keep serving an OLD build's JavaScript after a new
 * deploy — so bug fixes appeared to "do nothing" because the old code kept
 * running from cache. With network-first, a fresh deploy always loads as soon
 * as the device is online.
 *   • Only same-origin GET requests are touched.
 *   • SharePoint / Microsoft Graph / Firebase (cross-origin) are IGNORED — live
 *     data always goes straight to the network, never cached.
 *   • Non-GET requests (writes) are never intercepted.
 *
 * Bump CACHE_VERSION on any change — activate() deletes EVERY old cache.
 */
const CACHE_VERSION = 'tepl-hub-v4-netfirst';
const BASE = new URL(self.registration.scope).pathname; // e.g. "/thermotech-epc-hub/"
const SHELL = [BASE, BASE + 'index.html'];
 
self.addEventListener('install', (event) => {
  self.skipWaiting(); // take over immediately, don't wait for old tabs to close
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL).catch(() => {}))
  );
});
 
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Nuke EVERY cache (not just older versions) so no stale build can survive.
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});
 
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
 
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                 // never touch writes
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // live data / CDNs pass straight through
 
  // NETWORK-FIRST for the page AND every asset: always try the network so a new
  // deploy loads; fall back to cache only when the network is unavailable.
  event.respondWith((async () => {
    try {
      const net = await fetch(req, { cache: 'no-store' });
      if (net && net.status === 200 && net.type === 'basic') {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, net.clone()); // refresh the offline fallback
      }
      return net;
    } catch {
      const cache = await caches.open(CACHE_VERSION);
      return (await cache.match(req)) ||
             (await cache.match(BASE + 'index.html')) ||
             (await cache.match(BASE)) ||
             Response.error();
    }
  })());
});
 