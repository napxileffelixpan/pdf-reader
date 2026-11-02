// Offline-Cache für den PDF Vorleser. Bei Änderungen an App-Dateien VERSION erhöhen.
const VERSION = 'vorleser-v6';
// Große Laufzeitdateien der neuronalen Stimmen ändern sich praktisch nie → eigener Cache,
// der bei App-Updates erhalten bleibt (nur bei neuer Engine-Version TTS_CACHE erhöhen).
const TTS_CACHE = 'vorleser-tts-1';
// Heruntergeladene Stimmenmodelle (piper-models-v1, supertonic-v1) verwaltet die Seite selbst – nie löschen.
const KEEP = [VERSION, TTS_CACHE];

const FILES = ['./', 'index.html', 'manifest.webmanifest', 'lib/pdf.min.js', 'lib/pdf.worker.min.js',
  'lib/tts/piper-worker.js', 'lib/tts/supertonic-worker.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('vorleser-') && !KEEP.includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Header für „cross-origin isolation“: erst damit darf WebAssembly mehrere Rechenkerne nutzen.
// GitHub Pages erlaubt keine eigenen Server-Header, deshalb setzt sie der Service Worker.
function isolate(res) {
  if (!res || res.status === 0 || res.type === 'opaque') return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // z. B. Piper-Modell von Hugging Face: direkt durchreichen
  const scope = self.registration.scope;
  if (url.href.startsWith(scope + 'test/')) return;         // Testseite verwaltet sich selbst
  if (url.href.startsWith(scope + 'models/')) return;       // Supertonic-Modell: die Seite speichert es selbst (kein Doppel-Cache)

  if (req.mode === 'navigate') {
    // nur die App-Startseite selbst cachen – andere Seiten unverändert durchreichen
    const page = url.origin + url.pathname;
    if (page !== scope && page !== scope + 'index.html') return;
    // Seite: erst Netz (für Updates), sonst Cache
    e.respondWith(fetch(req).then(r => {
      const copy = r.clone(); caches.open(VERSION).then(c => c.put('index.html', copy)); return isolate(r);
    }).catch(() => caches.match('index.html').then(isolate)));
    return;
  }
  const isTtsBinary = url.pathname.includes('/lib/tts/') && !url.pathname.endsWith('-worker.js');
  const cacheName = isTtsBinary ? TTS_CACHE : VERSION;
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok && r.status === 200) { const copy = r.clone(); caches.open(cacheName).then(c => c.put(req, copy)); }
    return r;
  })).then(isolate));
});
