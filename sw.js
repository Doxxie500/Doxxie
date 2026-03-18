/* ================================================================
   OyoSays Service Worker — sw.js  v6
   PWABuilder / Play Store / Microsoft Store ready
   - Absolute paths (no ./ prefix) for PWABuilder compatibility
   - Proper fetch error handling (no opaque response caching)
   - Background sync placeholder registered
   - VAPID-ready Web Push handler
   - notificationclick navigates correctly inside installed PWA
   ================================================================ */

const SW_VER = 'oyosays-sw-v6';
const CACHE  = 'oyosays-cache-v6';

/* App shell — cached on install */
const PRECACHE = [
  '/',
  '/index.html',
  '/messenger.html',
  '/manifest.json',
  '/push.js',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/icon-96x96.png'
];

/* ── INSTALL ── */
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.allSettled(
        PRECACHE.map(url =>
          cache.add(new Request(url, { cache: 'reload' })).catch(err =>
            console.warn('[SW] Pre-cache miss for', url, err)
          )
        )
      )
    )
  );
});

/* ── ACTIVATE: wipe old caches ── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => clients.claim())
  );
});

/* ── FETCH ── */
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = req.url;

  /* Skip non-GET */
  if (req.method !== 'GET') return;

  /* Skip browser-extension requests */
  if (url.startsWith('chrome-extension://')) return;
  if (url.startsWith('moz-extension://'))    return;

  /* Skip all third-party / API calls — always live */
  const PASSTHROUGH = [
    'supabase.co',
    'googleapis.com',
    'cdnjs.cloudflare.com',
    'cdn.jsdelivr.net',
    'fonts.gstatic.com',
    'fonts.googleapis.com'
  ];
  if (PASSTHROUGH.some(h => url.includes(h))) return;

  /* HTML navigation: network-first, offline fallback to cached shell */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(req, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then(cached => cached || caches.match('/index.html'))
        )
    );
    return;
  }

  /* Everything else: cache-first, update in background */
  e.respondWith(
    caches.match(req).then(cached => {
      const fetchPromise = fetch(req).then(res => {
        /* Only cache valid same-origin responses */
        if (res && res.status === 200 && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone));
        }
        return res;
      }).catch(() => null);

      return cached || fetchPromise;
    })
  );
});

/* ── WEB PUSH (VAPID) ── */
self.addEventListener('push', e => {
  if (!e.data) return;
  let p;
  try   { p = e.data.json(); }
  catch { p = { title: 'OyoSays', body: e.data.text() }; }
  e.waitUntil(_show(p));
});

/* ── MESSAGES FROM APP ── */
self.addEventListener('message', e => {
  if (!e.data) return;

  /* Background-aware notification (checks if a window is actively focused) */
  if (e.data.type === 'OYOSAYS_NOTIF') {
    e.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
        const appOpen = cls.some(c => c.focused);
        if (!appOpen) return _show(e.data.payload);
      })
    );
  }

  /* Force notification — always shows (for likes, messages, follows etc.) */
  if (e.data.type === 'OYOSAYS_NOTIF_FORCE') {
    e.waitUntil(_show(e.data.payload));
  }

  /* Allow page to trigger SW update */
  if (e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ── SHOW NOTIFICATION ── */
function _show(p) {
  if (!p) return Promise.resolve();
  const options = {
    body:               p.body  || '',
    icon:               p.icon  || '/icons/icon-192x192.png',
    badge:              '/icons/icon-96x96.png',
    tag:                p.tag   || ('oyo-' + Date.now()),
    data:               { url: p.url || '/index.html' },
    vibrate:            [200, 80, 200],
    requireInteraction: false,
    silent:             false,
    timestamp:          Date.now()
  };
  return self.registration.showNotification(p.title || 'OyoSays', options);
}

/* ── NOTIFICATION CLICK ── */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/index.html';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
      /* Try to find and focus an existing app window */
      for (const c of cls) {
        const sameOrigin = c.url.startsWith(self.registration.scope) ||
                           c.url.startsWith(self.location.origin);
        if (sameOrigin && 'focus' in c) {
          c.postMessage({ type: 'OYOSAYS_NOTIF_CLICK', url: target });
          if (c.url !== target && 'navigate' in c) c.navigate(target);
          return c.focus();
        }
      }
      /* No existing window — open a new one */
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});

/* ── NOTIFICATION CLOSE (optional analytics) ── */
self.addEventListener('notificationclose', e => {
  /* Could send analytics here if needed */
});
