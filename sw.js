/* ===========================================================
   sw.js - offline cache for SuperTET Prep
   Bump CACHE version whenever you change files so phones refresh.
   =========================================================== */

const CACHE = 'supertet-prep-v8';

/* Everything needed for the app to work with no internet. */
const ASSETS = [
  './',
  './index.html',
  './404.html',
  './manifest.webmanifest',
  './css/styles.css',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/app.js',
  './js/auth.js',
  './js/util.js',
  './js/store.js',
  './js/data.js',
  './js/importer.js',
  './js/analytics.js',
  './js/home.js',
  './js/test.js',
  './js/result.js',
  './js/analytics-page.js',
  './js/flashcards.js',
  './js/manage.js',
  './js/subjects.js',
  './js/ai-prompt.js',
  './js/combo.js',
  './js/profile.js',
  './pages/test.html',
  './pages/result.html',
  './pages/analytics.html',
  './pages/flashcards.html',
  './pages/manage.html',
  './pages/subjects.html',
  './pages/profile.html',
  './data/index.json',
  './data/gk-gs.json',
  './data/child.json',
  './data/geography.json',
  './data/science.json',
  './data/hindi.json',
  './data/reasoning.json',
  './data/subjects.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => {
      // addAll fails if one file is missing, so add them one by one
      return Promise.all(ASSETS.map(url => cache.add(url).catch(() => null)));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // let CDN requests pass through
  if (url.pathname.includes('/api/')) return;    // let MongoDB backend API requests bypass cache

  // stale-while-revalidate for app files and question data
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached || caches.match('./index.html'));
      return cached || network;
    })
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
