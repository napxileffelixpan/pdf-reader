// Offline-Cache für den PDF Vorleser. Bei Änderungen VERSION erhöhen.
const VERSION = 'vorleser-v1';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'lib/pdf.min.js', 'lib/pdf.worker.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const isPage = e.request.mode === 'navigate';
  if (isPage) {
    // Seite: erst Netz (für Updates), sonst Cache
    e.respondWith(fetch(e.request).then(r => {
      const copy = r.clone(); caches.open(VERSION).then(c => c.put('index.html', copy)); return r;
    }).catch(() => caches.match('index.html')));
  } else {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});
