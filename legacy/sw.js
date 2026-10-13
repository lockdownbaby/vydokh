const CACHE = 'vydokh-premium-v3';
const ASSETS = ['./', 'index.html', 'config.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Сначала кэш, потом сеть: приложение открывается без интернета.
// После изменений в файлах увеличь номер в CACHE, чтобы обновить кэш у пользователей.
// Запросы к push-серверу (другой домен) в кэш не попадают.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('index.html')))
  );
});

// Push от сервера. Каждое сообщение обязательно показывается: этого требуют iOS и Chrome.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(self.registration.showNotification(d.title || 'Выдох', {
    body: d.body || 'Ты справляешься. Один день за раз.',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: d.tag || 'vydokh',
    data: { url: d.url || './' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow(url);
    })
  );
});
