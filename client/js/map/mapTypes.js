/* Map layer configuration and provider selection. Exposes window.AAM_MAP_TYPES.

   Which provider draws the map screen is a property of the theme, not of the
   page: theme.ui.type 1 is the built-in radial map over OSM tiles, type 2 is
   google_based. ?ui=1|2 overrides it for one visit (see js/theme.js).

   Ported from ClubMad's src/client/components/map/mapTypes.js — same idea, minus
   the bundler: this app has no build step, so the Google key comes from the
   server at runtime instead of being baked in as import.meta.env. */
(function () {
  'use strict';

  const MAP_PROVIDERS = { NATIVE: 'native', GOOGLE: 'google' };

  /* theme.ui.type -> provider. Unknown types fall back to the built-in map,
     which needs no key and no third party to be up. */
  const UI_TYPE_PROVIDER = { 1: MAP_PROVIDERS.NATIVE, 2: MAP_PROVIDERS.GOOGLE };

  let keyPromise = null;

  window.AAM_MAP_TYPES = {
    MAP_PROVIDERS,

    DEFAULT_MAP_CONFIG: {
      defaultCenter: { lat: 32.0736, lng: 34.7924 },   // תל אביב
      defaultZoom: 13,
      defaultRadius: 15,
    },

    MARKER_COLORS: {
      entity: '#16649e',
      danger: '#c33',
      user: '#a33',
      ring: '#16649e',
    },

    getMapProvider() {
      const type = window.AAM_THEME ? AAM_THEME.uiType() : 1;
      return UI_TYPE_PROVIDER[type] || MAP_PROVIDERS.NATIVE;
    },

    /* The browser key, served by /api/config. Resolves to '' when none is
       configured — callers treat that as "this provider cannot run". */
    getGoogleMapsApiKey() {
      if (!keyPromise) {
        keyPromise = fetch('/api/config')
          .then((r) => (r.ok ? r.json() : {}))
          .then((c) => c.googleMapsApiKey || '')
          .catch(() => '');
      }
      return keyPromise;
    },
  };
})();
