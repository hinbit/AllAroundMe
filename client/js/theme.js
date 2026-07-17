/* AllAroundMe theming: which brand the app wears, and which interface it wears it on.
   Loaded on every page, before anything that paints. Exposes window.AAM_THEME.

   A theme lives in client/themes/<name>/theme.json and may say as little as it
   likes: it is deep-merged ON TOP of the canabolabs base theme, so a missing
   asset, colour or opening resolves to canabolabs' value rather than to nothing.
   canabolabs is therefore the one theme that must stay complete.

   Note the two roles are separate: allaroundme is what you GET by default, while
   canabolabs is what every theme FALLS BACK TO. The product's own brand is a
   theme like any other, and the base is the demo brand that fills the gaps.

   Choosing a theme: ?theme=<name> (also remembered) > localStorage > the server's
   CLIENT_THEME > allaroundme. The interface type: ?ui=1|2 > the server's UI_TYPE
   > the theme's own ui.type > 1. The server sits above the theme on purpose — a
   deployment can put every theme on Google Maps without editing any of them —
   and below the query string, so testing still wins. */
(function () {
  'use strict';

  const BASE = 'canabolabs';          // merged UNDER every theme — see the note above
  const DEFAULT = 'allaroundme';      // loaded when nobody and nothing asked
  const STORE = 'aam_theme';
  const UI_TYPES = [1, 2];

  const qs = new URLSearchParams(location.search);

  function pickName(server) {
    const asked = qs.get('theme');
    if (asked) { try { localStorage.setItem(STORE, asked); } catch {} return asked; }
    try { return localStorage.getItem(STORE) || server.theme || DEFAULT; }
    catch { return server.theme || DEFAULT; }
  }

  const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);

  /* Later objects win, key by key, all the way down. Arrays and scalars replace
     rather than merge — a theme that lists something means that list, not that
     list appended to the base's. */
  function merge(base, over) {
    if (!isPlain(base) || !isPlain(over)) return over === undefined ? base : over;
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) {
      out[k] = isPlain(v) && isPlain(base[k]) ? merge(base[k], v) : v;
    }
    return out;
  }

  const getJSON = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));

  const AAM_THEME = {
    name: BASE,
    data: null,
    server: {},          // what /api/config answered (see config())
    _ready: null,
    _config: null,

    /* The deployment's own say: default theme, interface type, Maps key. Fetched
       once and shared — js/map/mapTypes.js reads the key back off this rather
       than asking again. Unreachable server = an app that still runs, on its own
       defaults. */
    config() {
      if (!this._config) {
        this._config = fetch('/api/config')
          .then((r) => (r.ok ? r.json() : {}))
          .catch(() => ({}));
      }
      return this._config;
    },

    load() {
      if (this._ready) return this._ready;
      this._ready = this.config().then((server) => {
        this.server = server || {};
        const name = pickName(this.server);
        const base = getJSON(`/themes/${BASE}/theme.json`).catch(() => ({}));
        const own = name === BASE ? base : getJSON(`/themes/${name}/theme.json`).catch(() => {
          console.warn(`[aam] theme "${name}" did not load — staying on ${BASE}`);
          return {};
        });
        return Promise.all([base, own]).then(([b, o]) => {
          this.data = merge(b, o);
          this.name = this.data.name || name;
          this.applyFavicon();
          return this.data;
        });
      });
      return this._ready;
    },

    /* Dotted lookup with a caller-supplied fallback, e.g. get('ui.type', 1). */
    get(path, fallback) {
      let cur = this.data;
      for (const key of String(path).split('.')) {
        if (!isPlain(cur) || !(key in cur)) return fallback;
        cur = cur[key];
      }
      return cur === undefined ? fallback : cur;
    },

    /* Resolve an asset name ("logo") to its URL. Animations name assets rather
       than paths so the same choreography works for any brand. */
    asset(name) { return this.get('assets.' + name, null); },

    /* Point the tab icon at the active theme's mark. The pages ship a static
       <link rel="icon"> so the tab is never blank while this resolves (and stays
       right if it never does) — this only ever swaps an icon that already works. */
    applyFavicon() {
      const href = this.asset('favicon');
      if (!href) return;
      let link = document.querySelector('link[rel="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      if (link.href === new URL(href, location.href).href) return;
      link.type = href.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
      link.href = href;
    },

    /* 1 = the built-in radial map · 2 = google_based.
       ?ui= (testing) > the server's UI_TYPE (the deployment) > the theme > 1.

       Only meaningful once load() has resolved: before that the theme is not
       here yet and this answers 1 for everything. Callers that build a map must
       await load() first — map.html does, in aamBoot. */
    uiType() {
      const forced = parseInt(qs.get('ui'), 10);
      if (UI_TYPES.includes(forced)) return forced;
      const fromServer = this.server && this.server.uiType;
      if (UI_TYPES.includes(fromServer)) return fromServer;
      const t = parseInt(this.get('ui.type', 1), 10);
      return UI_TYPES.includes(t) ? t : 1;
    },

    /* The open-screen animation to play, with the theme's overrides folded in. */
    openScreen() {
      const { animation: id = 'simplefade1', ...overrides } = this.get('openScreen', {}) || {};
      return getJSON(`/animations/${id}.json`)
        .then((anim) => merge(anim, overrides))
        .catch(() => null);
    },
  };

  AAM_THEME.load();
  window.AAM_THEME = AAM_THEME;
})();
