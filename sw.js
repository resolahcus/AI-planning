/* Bump this version whenever app files or question data change. */
const CACHE_NAME = 'ai-study-115-v4';
const CACHE_PREFIX = 'ai-study-115-';
const SCOPE = new URL(self.registration.scope);
const PRECACHE_PATHS = [
  './', './index.html', './styles.css',
  './js/app.js', './js/engine.js', './js/pwa.js',
  './manifest.webmanifest', './data/questions.json', './data/sources.json',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/maskable-192.png', './icons/maskable-512.png',
  './icons/apple-touch-icon.png', './icons/favicon.svg',
];
const ALLOWED_URLS = new Set(PRECACHE_PATHS.map((path) => new URL(path, SCOPE).href));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Reject redirects so a protected deployment cannot cache its login page as the app shell.
    await cache.addAll([...ALLOWED_URLS].map((url) => new Request(url, { cache: 'reload', redirect: 'error' })));
  })());
  // Updates wait until the user explicitly chooses to apply them.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const oldNames = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME);
    await Promise.all(oldNames.map(async (name) => {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      await Promise.all(keys.filter((request) => {
        const url = new URL(request.url);
        return url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname);
      }).map((request) => cache.delete(request)));
      if ((await cache.keys()).length === 0) await caches.delete(name);
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin) return;

  // Only app-owned, explicit resources are cached. APIs, login pages and PDFs bypass this worker.
  const canonical = new URL(url.href);
  canonical.search = '';
  canonical.hash = '';
  if (!ALLOWED_URLS.has(canonical.href)) return;
  if (url.search && request.mode !== 'navigate') return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(canonical.href);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic' && !response.redirected) {
      await cache.put(canonical.href, response.clone());
    }
    return response;
  })());
});
