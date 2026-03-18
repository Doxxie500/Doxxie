/* ================================================================
   OyoSays Push Notification Helper — push.js  v5
   PWABuilder / Netlify ready
   - Uses absolute paths for SW registration (no ./ prefix)
   - SW registration scoped to root '/' for PWABuilder compatibility
   - VAPID public-key placeholder wired up (fill in after Netlify deploy)
   - iOS Safari: deferred permission after user gesture + standalone check
   - Graceful fallback if Push API unavailable
   ================================================================ */

const OYOSAYS_PUSH = (() => {
  'use strict';

  let _swReg      = null;
  let _ready      = false;
  let _permission = (typeof Notification !== 'undefined') ? Notification.permission : 'denied';

  /* ── SVG badge icon (data URI — no external dependency) ── */
  const ICON = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<circle cx="32" cy="32" r="32" fill="#FFB300"/>' +
    '<text x="32" y="45" text-anchor="middle" font-size="34" font-weight="bold" fill="#fff" font-family="Arial">O</text>' +
    '</svg>'
  );

  /* ══════════════════════════════════════════════════════════════
     INIT — Register Service Worker
     Uses absolute path '/sw.js' so PWABuilder wraps it correctly
     ══════════════════════════════════════════════════════════════ */
  async function init() {
    if (!('serviceWorker' in navigator)) return false;
    if (!('Notification' in window))     return false;

    try {
      /* Absolute path + root scope = required by PWABuilder */
      _swReg = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none'
      });

      /* Trigger background update check */
      _swReg.update().catch(() => {});

      await navigator.serviceWorker.ready;
      _ready      = true;
      _permission = Notification.permission;

      navigator.serviceWorker.addEventListener('message', _onSwMsg);
      console.log('[OyoSays Push] SW ready v5');
      return true;
    } catch (err) {
      console.warn('[OyoSays Push] SW registration failed:', err);
      return false;
    }
  }

  /* ── Handle messages coming back FROM the SW ── */
  function _onSwMsg(e) {
    if (!e.data) return;
    if (e.data.type === 'OYOSAYS_NOTIF_CLICK') {
      const url = e.data.url || '';
      if (url.includes('messenger')) {
        try { sessionStorage.setItem('oyosays_nav_tab', 'messages'); } catch (_) {}
        if (!window.location.href.includes('messenger')) {
          window.location.href = '/messenger.html';
        }
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════
     REQUEST PERMISSION
     - iOS: only works when installed as PWA (standalone mode)
     - Delays 2.5 s so browser doesn't block the prompt
     ══════════════════════════════════════════════════════════════ */
  async function requestPermission(userName) {
    if (!('Notification' in window)) return false;

    _permission = Notification.permission;
    if (_permission === 'granted') return true;
    if (_permission === 'denied')  return false;

    /* iOS Safari only supports notifications in standalone (installed) mode */
    const isIos        = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone === true ||
                         window.matchMedia('(display-mode: standalone)').matches;
    if (isIos && !isStandalone) return false;

    /* Brief delay so the browser doesn't auto-dismiss the permission prompt */
    await new Promise(r => setTimeout(r, 2500));

    try {
      _permission = await Notification.requestPermission();
    } catch (_e) {
      /* Older Safari / Firefox use callback-style API */
      _permission = await new Promise(resolve => Notification.requestPermission(resolve));
    }

    if (_permission === 'granted') {
      _dispatchForce({
        title: '🔔 OyoSays Notifications Enabled',
        body:  'Hi' + (userName ? ' ' + userName : '') +
               '! You\'ll get alerts for likes, follows, messages and more.',
        tag:   'oyosays-welcome',
        url:   '/index.html'
      });
      return true;
    }
    return false;
  }

  /* ── Get the active SW controller ── */
  function _ctrl() {
    return (_swReg && _swReg.active) ||
           (navigator.serviceWorker && navigator.serviceWorker.controller) ||
           null;
  }

  /* ── NORMAL DISPATCH: background-only (checks window focus in SW) ──
     Used for low-priority events like new-post toasts. */
  function _dispatch(payload) {
    if (_permission !== 'granted') return;
    if (!payload || !payload.title) return;
    const ctrl = _ctrl();
    if (ctrl) ctrl.postMessage({
      type: 'OYOSAYS_NOTIF',
      payload: { icon: ICON, badge: ICON, ...payload }
    });
  }

  /* ── FORCE DISPATCH: always shows system notification ──
     Used for likes, comments, follows, messages.
     On mobile, visibilityState can stay 'visible' even when the screen
     is locked, so we bypass the focus check entirely. */
  function _dispatchForce(payload) {
    if (_permission !== 'granted') return;
    if (!payload || !payload.title) return;
    const ctrl = _ctrl();
    if (ctrl) ctrl.postMessage({
      type: 'OYOSAYS_NOTIF_FORCE',
      payload: { icon: ICON, badge: ICON, ...payload }
    });
  }

  /* ══════════════════════════════════════════════════════════════
     PUBLIC API
     ══════════════════════════════════════════════════════════════ */

  /** Likes, follows, comments, admin DMs, broadcasts */
  function notifyAppEvent(notif) {
    const icons = {
      like: '❤️', comment: '💬', follow: '👤',
      mention: '📣', admin_dm: '📢', broadcast: '📡',
      reply: '↩️', warning: '⚠️'
    };
    const icon = icons[notif && notif.type] || '🔔';
    const body = (notif && notif.message) || 'You have a new notification';
    _dispatchForce({
      title: icon + ' OyoSays',
      body:  body.length > 80 ? body.slice(0, 77) + '…' : body,
      tag:   'oyosays-notif-' + ((notif && notif.id) || Date.now()),
      url:   '/index.html'
    });
  }

  /** New chat message */
  function notifyMessage(senderName, plaintext, convoId) {
    const preview = ((plaintext || 'New message').replace(/\s+/g, ' ').trim());
    const body    = preview.length > 70 ? preview.slice(0, 67) + '…' : preview;
    _dispatchForce({
      title: '💬 ' + (senderName || 'Someone') + ' messaged you',
      body,
      tag:   'oyosays-msg-' + (convoId || 'new'),
      url:   '/messenger.html'
    });
  }

  /** New post in feed (background-only is fine here) */
  function notifyNewPost(authorName) {
    _dispatch({
      title: '🆕 New Post on OyoSays',
      body:  (authorName || 'Someone') + ' just posted in the Oyo State community',
      tag:   'oyosays-post-' + Date.now(),
      url:   '/index.html'
    });
  }

  /** Manual / custom send */
  function send(payload) { _dispatchForce(payload); }

  return { init, requestPermission, send, notifyAppEvent, notifyMessage, notifyNewPost };
})();
