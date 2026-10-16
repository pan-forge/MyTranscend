// MyTranscend Service Worker v2.0.1
const CACHE_NAME = 'mytranscend-v2.0.1';

// オフラインキャッシュ対象アセット
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/sheets.js',
  './js/scheduler.js',
  './js/gemini.js',
  './js/github.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon_character_toggle.png',
  './assets/images/001-通常-トラン.png',
  './assets/images/001-通常-ライス.png'
];

// インストール時にコアアセットをキャッシュ＆即時アクティベート
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching core assets (v1.9)');
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
});

// アクティベート時に古いキャッシュを完全破棄
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => {
          console.log('[SW] Deleting old cache:', key);
          return caches.delete(key);
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ネットワーク優先（Network First with Cache Fallback）
self.addEventListener('fetch', (event) => {
  // 外部API (Google Sheets, Gemini, CDN) はキャッシュさせず直接通信
  if (
    event.request.url.includes('googleapis.com') ||
    event.request.url.includes('google.com') ||
    event.request.url.includes('ajax.googleapis.com')
  ) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // 常に最新のネットワークを取得し、失敗した場合のみキャッシュへ
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});

// 通知クリック時の動作
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('index.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('./index.html');
      }
    })
  );
});
