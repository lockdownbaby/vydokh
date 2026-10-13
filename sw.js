const CACHE = 'vydokh-redesign-1.2.0';
const APP_PREFIX = 'vydokh-redesign-';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './src/app.js',
  './src/content.js',
  './src/domain.js',
  './src/icons.js',
  './src/storage.js',
  './src/styles.css'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => (key.startsWith(APP_PREFIX) && key !== CACHE) || key === 'vydokh-premium-v3').map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigation is network-first so deployments can deliver the latest HTML;
  // the versioned cache is used only when the network is unavailable.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response && response.ok) caches.open(CACHE).then(cache => cache.put('./index.html', response.clone()));
      return response;
    }).catch(() => caches.open(CACHE).then(cache => cache.match('./index.html'))));
    return;
  }

  event.respondWith(caches.open(CACHE).then(cache => cache.match(request).then(cached => {
    if (cached) return cached;
    return fetch(request).then(response => {
      if (response && response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    });
  })));
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = {}; }
  event.waitUntil(self.registration.showNotification(data.title || 'Выдох', {
    body: data.body || 'Сделай небольшую паузу. Ты можешь выбрать следующий шаг.',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: data.tag || 'vydokh',
    data: { url: data.url || './' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const scopeUrl = new URL(self.registration.scope);
  let targetUrl = scopeUrl.href;
  try {
    const requested = new URL((event.notification.data && event.notification.data.url) || './', scopeUrl);
    // Notification payloads must not navigate an installed PWA outside its own origin/scope.
    if (requested.origin === scopeUrl.origin && requested.href.startsWith(scopeUrl.href)) targetUrl = requested.href;
  } catch (_) { /* a malformed destination safely falls back to the app root */ }
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async list => {
    for (const client of list) {
      if (client.url && new URL(client.url).origin === scopeUrl.origin && 'focus' in client) {
        if ('navigate' in client && client.url !== targetUrl) {
          try { await client.navigate(targetUrl); } catch (_) { /* focus remains useful if navigation is blocked */ }
        }
        return client.focus();
      }
    }
    return self.clients.openWindow(targetUrl);
  }));
});
