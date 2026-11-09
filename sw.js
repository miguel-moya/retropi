// RetroPi — service worker: guarda la "carcasa" de la app para que abra rápido y sin conexión.
// Los datos de la colección NO pasan por aquí (se guardan aparte en el dispositivo).
const VERSION = 'retropi-v21';
const LOGOS = 'retropi-logos'; // logos de consola: se guardan una vez y se sirven desde el dispositivo
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/avatar.jpg', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== LOGOS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => {
  const logos = e.data && e.data.logos;
  if (!Array.isArray(logos)) return;
  e.waitUntil(caches.open(LOGOS).then(async c => {
    for (const u of logos) {
      if (await c.match(u)) continue;
      try { await c.put(u, await fetch(u, { mode: 'no-cors' })); } catch (_) {}
    }
  }));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) {
    // Imágenes externas: si es un logo guardado, sale del dispositivo; si no, a la red como siempre
    if (e.request.destination === 'image') e.respondWith(caches.open(LOGOS).then(c => c.match(e.request.url)).then(r => r || fetch(e.request)));
    return;
  }
  // Primero la red (para recibir actualizaciones); si no hay conexión, la copia guardada
  e.respondWith(
    fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
