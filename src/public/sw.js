/* Service worker minimal : installabilité PWA + shell hors-ligne.
   On ne met JAMAIS en cache les uploads, photos, API ou pages admin. */
var CACHE = 'obscura-v10';
var SHELL = [
  '/css/styles.css',
  '/js/filters.js',
  '/js/camera.js',
  '/js/pwa.js',
  '/js/pull-refresh.js',
  '/js/pwa-install.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(SHELL).catch(function () {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (k) {
          if (k !== CACHE) return caches.delete(k);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  // Ne pas intercepter : upload, photos, API, admin → toujours le réseau.
  // (Les galeries vivent sous /e/<slug>/… : on cherche le segment, pas le préfixe.)
  if (
    url.pathname.indexOf('/upload') !== -1 ||
    url.pathname.indexOf('/photos/') !== -1 ||
    url.pathname.indexOf('/api/') !== -1 ||
    url.pathname.startsWith('/admin')
  ) {
    return;
  }

  // Navigation (HTML) : réseau d'abord, cache en secours.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(function () {
        return caches.match(req).then(function (r) {
          return r || caches.match('/');
        });
      })
    );
    return;
  }

  // Statiques : cache d'abord, sinon réseau (et on met en cache).
  e.respondWith(
    caches.match(req).then(function (cached) {
      return (
        cached ||
        fetch(req).then(function (res) {
          if (res && res.ok && url.origin === self.location.origin) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        }).catch(function () { return cached; })
      );
    })
  );
});
