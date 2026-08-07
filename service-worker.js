// service-worker.js — Samavaya Niramaya PWA
//
// WHY v2: bump SHELL_CACHE version whenever app.js / index.html / style.css
// change so the browser evicts the old shell cache and fetches fresh files.
// Shell files use network-first so pushes to GitHub reflect immediately.

// SHELL_VERSION is replaced at deploy time by the CI workflow with the git SHA.
// This ensures every deploy busts the shell cache automatically — no manual version bumps needed.
const SHELL_CACHE = 'sn-shell-__SHELL_VERSION__';
// Use ISO date (YYYY-MM-DD) derived from UTC to avoid timezone inconsistencies across devices
const _today = new Date();
const DATA_CACHE  = `sn-data-${_today.getUTCFullYear()}-${String(_today.getUTCMonth()+1).padStart(2,'0')}-${String(_today.getUTCDate()).padStart(2,'0')}`;

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

// ── Activate: evict ALL old shell caches and stale data caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k =>
            (k.startsWith('sn-shell-') && k !== SHELL_CACHE) ||
            (k.startsWith('sn-data-')  && k !== DATA_CACHE)
          )
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────
// Shell files  → network-first (always try GitHub, fall back to cache)
//                This ensures pushes to GitHub are visible immediately.
// GCS data     → network-first (fresh daily JSON, fall back to today's cache)
// Everything else → cache-first (CDN assets, fonts, etc.)
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  const isGCSData = url.hostname === 'storage.googleapis.com' &&
                    url.pathname.includes('/samavaya-niramaya/daily/');

  const isGitHubRaw = url.hostname === 'raw.githubusercontent.com';

  const isShellFile = SHELL_FILES.some(f => {
    const path = f === './' ? '/' : f.replace('./', '/');
    return url.pathname === path || url.pathname.endsWith(f.replace('./', '/'));
  });

  if (isGCSData || isGitHubRaw) {
    // Network-first for all remote data (GCS daily JSON + GitHub raw latest.json)
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(DATA_CACHE).then(c => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
  } else if (isShellFile) {
    // Network-first for app shell: deploy changes reflect on next load
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(SHELL_CACHE).then(c => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // Cache-first for everything else (icons, fonts, etc.)
    event.respondWith(
      caches.match(event.request)
        .then(cached => cached || fetch(event.request))
    );
  }
});
