const CACHE_VERSION = 'zeronoise-v10';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const AUDIO_CACHE = `${CACHE_VERSION}-audio`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './app.js?v=20260622b',
  './mobile-app.js?v=20260622b',
  './style.css?v=20260622b',
  './mobile.css?v=20260622b',
  './manifest.json',
  './logo.png',
  './favicon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png'
];

const AUDIO_ASSETS = [
  './기본사운드/fire.mp3',
  './기본사운드/huge_wave.mp3',
  './기본사운드/night_field.mp3',
  './기본사운드/night_wave.mp3',
  './기본사운드/quiet_room.mp3',
  './기본사운드/rain.mp3',
  './기본사운드/wind.mp3'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('zeronoise-') && ![STATIC_CACHE, AUDIO_CACHE].includes(key))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) return cached;
  return (await network) || Response.error();
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put('./index.html', response.clone());
    return response;
  } catch {
    return cache.match('./index.html');
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }

  if (decodeURIComponent(url.pathname).includes('/기본사운드/')) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  event.respondWith(staleWhileRevalidate(event.request));
});

async function warmAudioCache() {
  const cache = await caches.open(AUDIO_CACHE);
  await Promise.allSettled(AUDIO_ASSETS.map((asset) => cache.add(asset)));
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data?.type === 'CACHE_AUDIO') {
    event.waitUntil(warmAudioCache());
  }
});
