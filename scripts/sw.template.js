// スマホ単独版の Service Worker：アプリのファイルを端末に保存して、電波がなくても起動できるようにする
// （scripts/build-phone.js がバージョンとファイル一覧を埋め込んで dist/phone-app/sw.js を作る）
const VERSION = '__VERSION__';
const ASSETS = __ASSETS__;
const CACHE = 'golf-app-' + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('golf-app-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// 画面の「更新する」ボタンから新しいバージョンに切り替える
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      const page = await cache.match('index.html');
      if (page) return page;
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    return fetch(req);
  })());
});
