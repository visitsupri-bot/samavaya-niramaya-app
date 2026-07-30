// service-worker.js — Samavaya Niramaya PWA

const SHELL_CACHE = 'sn-shell-v1';
const DATA_CACHE  = `sn-data-${new Date().toLocaleDateString('en-CA')}`;

const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// ── Install: cache app shell ──────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: evict old data caches ──────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('sn-data-') && k !== DATA_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: shell = cache-first, data = network-first ─────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const isGCSData = url.hostname === 'storage.googleapis.com' &&
                    url.pathname.includes('/samavaya-niramaya/daily/');

  if (isGCSData) {
    // Network-first: always try fresh daily JSON, fall back to cache
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(DATA_CACHE).then(c => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // Cache-first: app shell files
    event.respondWith(
      caches.match(event.request)
        .then(cached => cached || fetch(event.request))
    );
  }
});
