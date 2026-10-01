/* Bloopet Service Worker — offline support */
var CACHE_VER  = 'v5';
var CORE_CACHE = 'bloopet-core-'  + CACHE_VER;
var GAME_CACHE = 'bloopet-games-' + CACHE_VER;
var CDN_CACHE  = 'bloopet-cdn-'   + CACHE_VER;

/* Core assets pre-cached on install */
var CORE_ASSETS = [
  '/',
  '/main.css',
  '/manifest.json',
  '/offline.html',
  '/games/cursor-workshop/',
  '/games/background-workshop/',
  '/games/cursor-trail-workshop/',
  '/games/404-workshop/'
];

/* ---- Install: pre-cache core shell ---- */
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CORE_CACHE).then(function(cache) {
      return cache.addAll(CORE_ASSETS);
    }).then(function() {
      /* Take control immediately so offline works on the very first visit */
      return self.skipWaiting();
    })
  );
});

/* ---- Activate: delete old caches + claim all tabs ---- */
self.addEventListener('activate', function(event) {
  var keep = [CORE_CACHE, GAME_CACHE, CDN_CACHE];
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return keep.indexOf(k) === -1; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      /* Control all open tabs immediately */
      return self.clients.claim();
    })
  );
});

/* ---- Fetch ---- */
self.addEventListener('fetch', function(event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch(e) { return; }

  /* SSE / WebSocket: always network */
  if (url.pathname === '/api/sse') return;

  /* API calls: network-first, offline → empty JSON error */
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkOnlyWithFallback(req));
    return;
  }

  /* Cross-origin (CDN fonts, game thumbnails): cache-first */
  if (url.origin !== self.location.origin) {
    event.respondWith(cacheFirst(req, CDN_CACHE));
    return;
  }

  /* Game assets: cache-first (games don't change often) */
  if (url.pathname.startsWith('/games/')) {
    event.respondWith(cacheFirst(req, GAME_CACHE));
    return;
  }

  /* Everything else (core pages, CSS, images, etc.): stale-while-revalidate */
  event.respondWith(staleWhileRevalidate(req, CORE_CACHE));
});

/* ──────────────── Strategies ──────────────── */

/* Network-only; if offline return a JSON error */
function networkOnlyWithFallback(req) {
  return fetch(req).catch(function() {
    return new Response(
      JSON.stringify({ error: 'offline', message: "You're offline — this feature needs the internet." }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  });
}

/* Cache-first: serve cached copy; if missing, fetch and cache */
function cacheFirst(req, cacheName) {
  return caches.open(cacheName).then(function(cache) {
    return cache.match(req).then(function(cached) {
      if (cached) return cached;
      return fetch(req).then(function(res) {
        if (res.ok || res.type === 'opaque') {
          cache.put(req, res.clone());
        }
        return res;
      }).catch(function() {
        /* Nothing cached, nothing online */
        if (req.mode === 'navigate') {
          return caches.match('/offline.html').then(function(r) {
            return r || new Response('Offline', { status: 503 });
          });
        }
        return new Response('Offline', { status: 503 });
      });
    });
  });
}

/* Stale-while-revalidate: serve cache immediately, refresh in background */
function staleWhileRevalidate(req, cacheName) {
  return caches.open(cacheName).then(function(cache) {
    return cache.match(req).then(function(cached) {
      var fetchPromise = fetch(req).then(function(res) {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(function() {
        /* Network failed — serve offline page for navigations */
        if (req.mode === 'navigate') {
          return caches.match('/offline.html').then(function(r) {
            return r || new Response('<h1>You are offline</h1>', {
              status: 200, headers: { 'Content-Type': 'text/html' }
            });
          });
        }
        /* For sub-resources (CSS, images, etc.) just return empty 503 */
        return new Response('', { status: 503 });
      });
      return cached || fetchPromise;
    });
  });
}
