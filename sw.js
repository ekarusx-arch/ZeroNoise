const CACHE_VERSION = 'zeronoise-v14';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const AUDIO_CACHE = `${CACHE_VERSION}-audio`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './app.js?v=20260622f',
  './mobile-app.js?v=20260622f',
  './style.css?v=20260622f',
  './mobile.css?v=20260622f',
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

async function serveAudio(request) {
  const rangeHeader = request.headers.get('range');
  if (!rangeHeader) return cacheFirst(request);

  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(request.url);
  if (!cached) return fetch(request);

  const buffer = await cached.arrayBuffer();
  const size = buffer.byteLength;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) return fetch(request);

  const suffixLength = match[1] ? null : Number(match[2]);
  const start = match[1] ? Number(match[1]) : Math.max(size - suffixLength, 0);
  const end = match[2] && match[1] ? Math.min(Number(match[2]), size - 1) : size - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` }
    });
  }

  const headers = new Headers(cached.headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));

  return new Response(buffer.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers
  });
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
    event.respondWith(serveAudio(event.request));
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
