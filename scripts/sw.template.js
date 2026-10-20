/* Mamboka service worker. scripts/sw.mjs fills in the build id and the asset list after `next build`
 * and writes the result to public/sw.js; edit this template, not that file.
 *
 * Everything the game needs (the page, its scripts and styles, the Latin font slices, the sprites and
 * the voice clips) is stored at install under a cache named after the build, so a home-screen launch
 * works without a network. A new deploy is a new worker: it fills its own cache, takes over, and the
 * previous build's cache is dropped — the shell served offline always matches the scripts next to it. */

const VERSION = '__VERSION__';
const CACHE = `mamboka-${VERSION}`;
const PRECACHE = __PRECACHE__;
const PRECACHED = new Set(PRECACHE);
/** Every navigation is answered with the app shell when the network does not come through. */
const SHELL = '/';
/** How long an online launch waits for fresh HTML before showing the precached shell. */
const NAVIGATE_TIMEOUT_MS = 2000;

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Hashed assets are immutable, so the HTTP cache may answer; the shell and the unhashed files
      // are fetched afresh so the precache really is this build.
      await cache.addAll(
        PRECACHE.map(url => new Request(url, {cache: url.startsWith('/_next/static/') ? 'default' : 'reload'})),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith('mamboka-') && key !== CACHE).map(key => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', event => {
  const {request} = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
  } else if (url.pathname.startsWith('/_next/static/') || PRECACHED.has(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
  // Anything else (launch images, dev-server files) goes straight to the network.
});

/** Fresh HTML when the network answers in time; otherwise this build's shell. */
async function navigate(request) {
  const shell = () => caches.open(CACHE).then(cache => cache.match(SHELL));
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAVIGATE_TIMEOUT_MS)),
    ]);
    if (response.ok) return response;
    return (await shell()) ?? response;
  } catch (err) {
    const cached = await shell();
    if (cached) return cached;
    throw err;
  }
}

/** Precached or previously fetched assets come from the cache; anything new is fetched and kept. */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request.url);
  if (cached) return withRange(request, cached);
  const response = await fetch(request);
  // Only complete responses are kept; a 206 answering a Range request would be served as the whole file.
  if (response.status === 200) await cache.put(request.url, response.clone());
  return response;
}

/**
 * Media elements ask for byte ranges (Safari insists on a 206 for them, and will not play the
 * keep-alive clip from a 200), so a cached full response is sliced to the range asked for.
 */
async function withRange(request, response) {
  const range = request.headers.get('range');
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || response.status !== 200) return response;
  const body = await response.arrayBuffer();
  const total = body.byteLength;
  const start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
  if (start > end || start >= total) {
    return new Response(null, {status: 416, statusText: 'Range Not Satisfiable', headers: {'Content-Range': `bytes */${total}`}});
  }
  const headers = new Headers(response.headers);
  headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(body.slice(start, end + 1), {status: 206, statusText: 'Partial Content', headers});
}
