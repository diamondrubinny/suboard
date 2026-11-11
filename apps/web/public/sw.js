/* SUBoard service worker.
 * Privacy by design: it stores ONLY the offline page and its icon. Pages, build assets (already
 * cached by the browser for a year — they are content-hashed) and API responses (/api/*) always
 * go to the network; no board data is ever stored on the device.
 */
const VERSION = 'suboard-shell-v3';
// Relative to the worker's scope, so the app also works under a folder (e.g. /test/).
const at = (p) => new URL(p, self.registration.scope).href;
const PRECACHE = ['offline.html', 'offline.css', 'favicon.svg', 'icon-192.png'].map(at);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only top-level page loads are handled: network first, the offline page if the network fails.
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  event.respondWith(fetch(req).catch(() => caches.match(at('offline.html'))));
});
