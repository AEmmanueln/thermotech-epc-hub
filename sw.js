/* Thermotech EPC Operations Hub — service worker
 * Makes the app installable and loadable OFFLINE by caching the app shell and
 * static build assets. It is deliberately conservative:
 *   • Only same-origin GET requests are ever cached.
 *   • SharePoint / Microsoft Graph / Firebase (all cross-origin) are IGNORED —
 *     they pass straight through, so live data is never served stale or cached.
 *   • Non-GET requests (writes) are never intercepted.
 * The app already saves every change to localStorage and queues writes, so the
 * data layer is untouched by this file. This only lets the app open without a
 * network connection.
 *
 * Bump CACHE_VERSION whenever you want every client to drop its old shell cache.
 */
const CACHE_VERSION = 'tepl-hub-v1';
const BASE = new URL(self.registration.scope).pathname; // e.g. "/thermotech-epc-hub/"
const SHELL = [BASE, BASE + 'index.html'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Never touch writes.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only ever handle our own origin. SharePoint, Graph, Firebase, CDNs — all
  // cross-origin — are left entirely alone so live data is always fresh.
  if (url.origin !== self.location.origin) return;

  // App navigation → network-first (so new deploys load), fall back to the
  // cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, net.clone());
        return net;
      } catch {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match(req)) ||
               (await cache.match(BASE + 'index.html')) ||
               (await cache.match(BASE)) ||
               Response.error();
      }
    })());
    return;
  }

  // Static assets (hashed JS/CSS/fonts/images) → stale-while-revalidate.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req);
    const fetching = fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await fetching) || Response.error();
  })());
});
