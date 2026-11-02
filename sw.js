// Offline-Cache für den PDF Vorleser. Bei Änderungen an App-Dateien VERSION erhöhen.
const VERSION = 'vorleser-v3';
// Große Laufzeitdateien der neuronalen Stimme ändern sich praktisch nie → eigener Cache,
// der bei App-Updates erhalten bleibt (nur bei neuer Engine-Version TTS_CACHE erhöhen).
const TTS_CACHE = 'vorleser-tts-1';
// Heruntergeladene Stimmenmodelle (von der Seite selbst verwaltet) – niemals löschen.
const KEEP = [VERSION, TTS_CACHE, 'piper-models-v1'];

const FILES = ['./', 'index.html', 'manifest.webmanifest', 'lib/pdf.min.js', 'lib/pdf.worker.min.js',
  'lib/tts/piper-worker.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('vorleser-') && !KEEP.includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // z. B. Modell-Download: direkt durchreichen

  if (req.mode === 'navigate') {
    // Seite: erst Netz (für Updates), sonst Cache
    e.respondWith(fetch(req).then(r => {
      const copy = r.clone(); caches.open(VERSION).then(c => c.put('index.html', copy)); return r;
    }).catch(() => caches.match('index.html')));
    return;
  }
  const isTtsBinary = url.pathname.includes('/lib/tts/') && !url.pathname.endsWith('piper-worker.js');
  const cacheName = isTtsBinary ? TTS_CACHE : VERSION;
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok && r.status === 200) { const copy = r.clone(); caches.open(cacheName).then(c => c.put(req, copy)); }
    return r;
  })));
});
