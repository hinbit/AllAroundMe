/* Map provider factory — window.AAM_MAP.

   Ported from ClubMad's src/client/components/map/MapProviderFactory.jsx: pick the
   provider the configuration asks for, and keep every caller talking to one
   interface regardless of which one answered.

   Where it differs: ClubMad renders an "unsupported provider" panel when the
   choice cannot be honoured. Here a map screen with no map is a dead end — the
   whole app is "find the care near you" — so a provider that cannot mount (no
   Google key, Google unreachable, an unknown ui.type) hands the screen back to
   the built-in map, which depends on nothing we do not control. */
(function () {
  'use strict';

  const impl = (name) => ({
    native: window.AAM_MAP_NATIVE,
    google: window.AAM_MAP_GOOGLE,
  }[name]);

  window.AAM_MAP = {
    /* ctx is the map screen's window onto its own state — see map.html:
         el, inner, tiles          the DOM the providers draw into
         entities(), loc(), radiusKm()
         emoji(e), isDanger(e), relStar(id), minutes(km)
         onEntity(e), track(), isActive(), modalOpen(), onFallback(reason) */
    create(ctx) {
      const wanted = AAM_MAP_TYPES.getMapProvider();
      let active = null;

      function mount(name) {
        const provider = impl(name);
        if (!provider) return Promise.reject(new Error('unknown provider: ' + name));
        active = provider.create(ctx);
        return Promise.resolve(active.mount());
      }

      const ready = mount(wanted).catch((err) => {
        if (wanted === 'native') throw err;         // nothing left to fall back to
        console.warn(`[aam] map provider "${wanted}" unavailable (${err.message}) — using the built-in map`);
        if (active) { try { active.destroy(); } catch {} }
        ctx.onFallback(wanted, err);
        return mount('native');
      });

      return {
        get id() { return active ? active.id : wanted; },
        ready,
        render() { if (active) active.render(); },
        reset() { if (active) active.reset(); },
        destroy() { if (active) active.destroy(); },
      };
    },
  };
})();
