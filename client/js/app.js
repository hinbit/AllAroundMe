/* AllAroundMe core: uid cookie, session handshake, event logging.
   Loaded on every page. Exposes window.AAM. */
(function () {
  'use strict';

  const COOKIE = 'aam_uid';
  const TTL_DAYS_DEFAULT = 90;

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function setCookie(name, value, days) {
    const d = new Date(Date.now() + days * 86400000);
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
  }

  function parseUA() {
    const ua = navigator.userAgent;
    const browser =
      /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' :
      /Safari\//.test(ua) && !/Chrome/.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Other';
    const os =
      /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' :
      /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
    const device = /Mobi|Android|iPhone/.test(ua) ? 'mobile' : 'desktop';
    return { browser, os, device };
  }

  const AAM = {
    uid: getCookie(COOKIE) || '',
    sessionId: null,
    profile: null,
    splash: 'full',
    ratePrompt: [],
    newBadges: [],
    _queue: [],
    _ready: null,

    // Session start: send the full handshake, receive uid + splash decision.
    hello() {
      if (this._ready) return this._ready;
      const ua = parseUA();
      const body = {
        uid: this.uid,
        browser: ua.browser, os: ua.os, device: ua.device,
        screen_w: screen.width, screen_h: screen.height,
        viewport_w: innerWidth, viewport_h: innerHeight,
        pixel_ratio: devicePixelRatio || 1,
        lang: navigator.language,
        timezone: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || '',
        display_mode: matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'standalone' : 'browser',
        referrer: document.referrer || '',
      };
      this._ready = fetch('/api/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
        .then((r) => r.json())
        .then((data) => {
          this.uid = data.uid;
          this.sessionId = data.session_id;
          this.profile = data.profile;
          this.splash = data.splash;
          this.ratePrompt = data.rate_prompt || [];
          this.newBadges = data.new_badges || [];
          setCookie(COOKIE, data.uid, data.cookie_ttl_days || TTL_DAYS_DEFAULT);
          return data;
        })
        .catch(() => {
          // offline / server down — keep the app usable
          if (!this.uid) { this.uid = 'local-' + Math.random().toString(36).slice(2, 12); }
          return { uid: this.uid, splash: 'full', profile: null };
        });
      return this._ready;
    },

    // Queue an event; flushed in small batches.
    track(type, element, data) {
      this._queue.push({ type, page: location.pathname, element: element || null, data: data || null });
      clearTimeout(this._t);
      this._t = setTimeout(() => this.flush(), 800);
    },

    flush() {
      if (!this._queue.length || !this.uid || this.uid.startsWith('local-')) return;
      const events = this._queue.splice(0, 50);
      const payload = JSON.stringify({ uid: this.uid, session_id: this.sessionId, events });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/events', new Blob([payload], { type: 'application/json' }));
      } else {
        fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }).catch(() => {});
      }
    },

    chosen(entity) {
      this.track('choose_doctor', entity.name, entity);
      return fetch('/api/profile/chosen', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: this.uid, entity_id: entity.id, entity_name: entity.name, entity_spec: entity.spec }),
      }).catch(() => {});
    },

    action(text) {
      return fetch('/api/transcripts/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: this.uid, action: text }),
      }).catch(() => {});
    },

    skipSplashForever() {
      return fetch('/api/profile/skip-splash', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: this.uid }),
      }).catch(() => {});
    },
  };

  addEventListener('pagehide', () => AAM.flush());
  addEventListener('visibilitychange', () => { if (document.hidden) AAM.flush(); });

  // register the PWA service worker (works installed or straight from the web)
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  window.AAM = AAM;
})();
