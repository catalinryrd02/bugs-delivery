/* LOS BUGS DELIVERY - Service Worker
   - App shell precacheado (funciona sin internet)
   - API GET: red primero, caché como respaldo
   - Imágenes y mapas: caché con actualización
   Sube CACHE_VERSION cada vez que cambies archivos para forzar actualización. */
const CACHE_VERSION = 'v7';
const SHELL_CACHE = 'losbugs-shell-' + CACHE_VERSION;
const API_CACHE = 'losbugs-api-' + CACHE_VERSION;
const IMG_CACHE = 'losbugs-img-' + CACHE_VERSION;
const TILE_CACHE = 'losbugs-tiles-' + CACHE_VERSION;
const CURRENT = [SHELL_CACHE, API_CACHE, IMG_CACHE, TILE_CACHE];

const SHELL = [
  '/', '/index.html', '/cliente.html', '/admin.html', '/repartidor.html', '/offline.html',
  '/styles.css', '/cliente.css', '/app.js', '/pwa.js', '/cliente-ui.js', '/pago.html', '/manifest.json',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-192.png',
  '/icons/maskable-512.png', '/icons/apple-touch-icon.png', '/icons/favicon-48.png', '/icons/logo.png',
  '/img/bread.svg', '/img/burger.svg', '/img/burrito.svg', '/img/cake.svg', '/img/cheese.svg', '/img/chicken.svg', '/img/coffee.svg', '/img/donut.svg', '/img/drink.svg', '/img/fries.svg', '/img/hotdog.svg', '/img/icecream.svg', '/img/pancakes.svg', '/img/pasta.svg', '/img/pizza.svg', '/img/salad.svg', '/img/sandwich.svg', '/img/sushi.svg', '/img/tacos.svg'
];

// Librerías externas (Leaflet). Si no hay red al instalar, se guardan después al usarse.
const EXTERNAL = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/layers.png'
];

const PLACEHOLDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260" viewBox="0 0 400 260">' +
  '<rect width="400" height="260" fill="#FBE0EC"/><circle cx="200" cy="120" r="46" fill="#F3ADC9"/>' +
  '<text x="200" y="215" font-family="sans-serif" font-size="20" font-weight="700" text-anchor="middle" fill="#7B2857">LOS BUGS</text></svg>';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL);
    await Promise.all(EXTERNAL.map(async (url) => {
      try { await cache.add(new Request(url, { mode: 'cors' })); } catch (e) { /* se guardará luego */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('losbugs-') && !CURRENT.includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length > max) {
    await cache.delete(keys[0]);
    return trimCache(name, max);
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then(res => {
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(request, res.clone()).then(() => maxEntries && trimCache(cacheName, maxEntries));
    }
    return res;
  }).catch(() => null);
  return cached || (await network);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST/PUT/DELETE los maneja pwa.js (cola offline)
  const url = new URL(req.url);

  // Pagos: siempre directo a la red (nunca desde caché)
  if (url.origin === self.location.origin && (url.pathname.startsWith('/api/pagos/') || /^\/api\/pedidos\/\d+\/pago$/.test(url.pathname))) return;

  // API propia
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(
      networkFirst(req, API_CACHE).catch(() =>
        new Response(JSON.stringify({ error: 'Sin conexión' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))
    );
    return;
  }

  // Navegación (páginas HTML)
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (e) {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match(req, { ignoreSearch: true })) ||
               (await cache.match('/index.html')) ||
               (await cache.match('/offline.html'));
      }
    })());
    return;
  }

  // Mosaicos del mapa
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(staleWhileRevalidate(req, TILE_CACHE, 150).then(r => r || Response.error()));
    return;
  }

  // Imágenes (platillos)
  if (req.destination === 'image') {
    event.respondWith(
      staleWhileRevalidate(req, IMG_CACHE, 80).then(r => r ||
        new Response(PLACEHOLDER_SVG, { headers: { 'Content-Type': 'image/svg+xml' } }))
    );
    return;
  }

  // Resto (CSS, JS, Leaflet, fuentes): caché primero, luego red
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(req, { ignoreSearch: url.origin === self.location.origin });
    if (cached) {
      // refresca en segundo plano
      fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    } catch (e) {
      return Response.error();
    }
  })());
});
