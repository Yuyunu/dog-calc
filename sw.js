// Service Worker — 永遠 network-first，舊 cache 是 fallback
// 每次載入 HTML/JS/CSS 都試網路抓新版

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // 清除所有舊 cache
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // 網路優先，失敗才用 cache（離線 fallback）
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .catch(() => caches.match(e.request))
  );
});
