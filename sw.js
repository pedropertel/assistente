// ══════════════════════════════════════════
// SERVICE WORKER — Cache-first para assets
// ══════════════════════════════════════════

const CACHE_NAME = 'assistente-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// Install: cachear assets estáticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: limpar caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first para assets, network-first para API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-first para API Supabase
  if (url.hostname.includes('supabase') || url.hostname.includes('jsdelivr')) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  // Cache-first para assets locais
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
