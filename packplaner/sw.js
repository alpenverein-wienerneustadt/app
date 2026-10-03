// Packplaner Service Worker
// Sorgt dafür, dass die App auch ohne Internetverbindung öffnet und Listen erstellen kann.
// Wichtig: Firebase-Anfragen (Login, Cloud-Speichern, Teilen, Gemeinsam packen)
// funktionieren weiterhin NUR mit Verbindung - die werden hier bewusst nicht
// abgefangen, sondern laufen normal über das Netzwerk.

// Bei jeder Änderung an dieser Datei die Versionsnummer erhöhen.
const CACHE_NAME = 'packplaner-cache-v2';

// Kern-Dateien, die beim ersten Besuch sofort vorab zwischengespeichert werden.
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './logo.png',
  './alpenverein.png',
  './feedback-admin.html',
  './feedback-admin-manifest.json'
];

// Die Firebase-Programmbibliothek (nicht die Daten!) wird ebenfalls zwischengespeichert:
// Ohne sie startet der Listen-Generator offline gar nicht (z.B. auf der Hütte ohne Empfang).
const FIREBASE_SDK_PREFIX = 'https://www.gstatic.com/firebasejs/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .catch((err) => console.warn('SW: Vorab-Caching teilweise fehlgeschlagen:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function putInCache(request, response) {
  if (response && (response.status === 200 || response.type === 'opaque')) {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Firebase-Bibliothek: versioniert & unveränderlich -> Cache zuerst.
  if (url.href.startsWith(FIREBASE_SDK_PREFIX)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => putInCache(request, res)))
    );
    return;
  }

  // Alles andere fremde (Firebase-Daten, Google-APIs, YouTube ...) läuft unangetastet übers Netzwerk.
  if (url.origin !== self.location.origin) return;

  // Die App-Seite selbst (index.html, auch mit ?tour=...-Links): NETZWERK ZUERST.
  // So sieht jeder nach einem Update sofort die neue Version - der Cache dient nur
  // noch als Rückfall, wenn keine Verbindung besteht.
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Unter der Adresse ohne ?tour=... ablegen, damit nicht jeder geteilte Link extra im Cache landet.
          if (res && res.status === 200) {
            const copy = res.clone();
            const cleanUrl = url.origin + url.pathname;
            caches.open(CACHE_NAME).then((cache) => cache.put(cleanUrl, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(request, { ignoreSearch: true })
            .then((cached) => cached || caches.match('./index.html'))
        )
    );
    return;
  }

  // Bilder, Icons, Manifest ...: sofort aus dem Cache, im Hintergrund aktualisieren.
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const networkFetch = fetch(request)
        .then((res) => putInCache(request, res))
        .catch(() => cachedResponse);
      return cachedResponse || networkFetch;
    })
  );
});
