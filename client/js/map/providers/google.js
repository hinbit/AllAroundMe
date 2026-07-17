/* Map provider · google_based (theme ui.type 2) — window.AAM_MAP_GOOGLE.

   Ported from ClubMad's src/client/components/map/providers/GoogleMapView.jsx:
   the same script-tag loader (no SDK dependency), the same emoji-in-a-circle
   markers, the same user marker + radius circle. Two deliberate differences:

     · the key arrives from /api/config at runtime, because this app has no build
       step to inline it with (see js/map/mapTypes.js);
     · a marker click opens the app's own entity card rather than an InfoWindow —
       that card is where the relation/WhatsApp flows live, and duplicating a
       thinner version of it inside a bubble would only strand the user.

   Google owns pan, zoom, tiles and projection here, so the built-in map's zoom
   chrome is hidden while this provider is mounted.

   Providers implement: mount() · render() · reset() · destroy(). */
(function () {
  'use strict';

  /* Resolve only once the API is actually usable — the script's load event fires
     before google.maps has finished populating itself. */
  function loadGoogleMapsScript(apiKey) {
    return new Promise((resolve, reject) => {
      const ready = () => !!(window.google && google.maps && google.maps.Map && google.maps.Marker);
      const poll = () => { if (ready()) resolve(google.maps); else setTimeout(poll, 50); };
      if (ready()) return resolve(google.maps);

      const existing = document.getElementById('google-maps-script');
      if (existing) { existing.addEventListener('load', poll); poll(); return; }

      const script = document.createElement('script');
      script.id = 'google-maps-script';
      script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(apiKey)
        + '&libraries=marker&language=he&region=IL&loading=async';
      script.async = true;
      script.defer = true;
      script.onload = poll;
      script.onerror = () => reject(new Error('Google Maps API did not load'));
      document.head.appendChild(script);
    });
  }

  /* An emoji in a coloured disc — the same vocabulary the built-in pins use, so
     switching interface type does not change what a pin means. */
  function emojiIcon(emoji, color) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">'
      + `<circle cx="20" cy="20" r="17" fill="#fff" stroke="${color}" stroke-width="3"/>`
      + `<text x="20" y="27" font-size="18" text-anchor="middle">${emoji}</text></svg>`;
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(40, 40),
      anchor: new google.maps.Point(20, 20),
    };
  }

  window.AAM_MAP_GOOGLE = {
    id: 'google',
    create(ctx) {
      const C = AAM_MAP_TYPES.MARKER_COLORS;
      const mapEl = ctx.el;
      let map = null, host = null;
      let markers = [], userMarker = null, circles = [];
      let ready = false, wantsRender = false, refit = true;

      function clear() {
        markers.forEach((m) => m.setMap(null));
        markers = [];
        circles.forEach((c) => c.setMap(null));
        circles = [];
      }

      function render() {
        // renderViews() can ask for a map before Google has answered; remember the
        // ask and honour it on arrival rather than dropping it.
        if (!ready) { wantsRender = true; return; }
        clear();
        const LOC = ctx.loc();
        const km = ctx.radiusKm();
        const here = { lat: LOC.lat, lng: LOC.lng };

        if (!userMarker) {
          userMarker = new google.maps.Marker({
            map, position: here, title: 'את/ה כאן', zIndex: 3,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8, fillColor: C.user, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3,
            },
          });
        } else {
          userMarker.setPosition(here);
        }

        // the same two distance rings the built-in map draws
        [Math.round(km / 2 * 10) / 10, km].forEach((r) => {
          circles.push(new google.maps.Circle({
            map, center: here, radius: r * 1000,
            strokeColor: C.ring, strokeOpacity: .45, strokeWeight: 1,
            fillOpacity: 0, clickable: false, zIndex: 1,
          }));
        });

        const bounds = new google.maps.LatLngBounds();
        bounds.extend(here);
        ctx.entities().forEach((e) => {
          const pos = { lat: e.lat, lng: e.lng };
          const m = new google.maps.Marker({
            map, position: pos, zIndex: 2,
            title: e.name + ' · ' + ctx.minutes(e.km) + ' דק׳',
            icon: emojiIcon(ctx.emoji(e) + ctx.relStar(e.id), ctx.isDanger(e) ? C.danger : C.entity),
          });
          m.addListener('click', () => ctx.onEntity(e));
          markers.push(m);
          bounds.extend(pos);
        });

        /* Fit once per result set. Re-fitting on every render would yank the view
           back every time the user panned away to look at something. */
        if (refit && !bounds.isEmpty()) {
          map.fitBounds(bounds, 48);
          refit = false;
        }
      }

      return {
        id: 'google',

        mount() {
          mapEl.classList.add('gmap');   // hides the built-in zoom chrome (css/map)
          host = document.createElement('div');
          host.className = 'gmap-host';
          mapEl.appendChild(host);

          return AAM_MAP_TYPES.getGoogleMapsApiKey()
            .then((key) => {
              if (!key) throw new Error('no-key');
              return loadGoogleMapsScript(key);
            })
            .then(() => {
              const LOC = ctx.loc();
              const cfg = AAM_MAP_TYPES.DEFAULT_MAP_CONFIG;
              map = new google.maps.Map(host, {
                center: LOC.lat != null ? { lat: LOC.lat, lng: LOC.lng } : cfg.defaultCenter,
                zoom: cfg.defaultZoom,
                mapTypeControl: false,
                fullscreenControl: false,
                streetViewControl: false,
              });
              ready = true;
              if (wantsRender) { wantsRender = false; render(); }
            });
        },

        render,
        reset() { refit = true; },

        destroy() {
          clear();
          if (userMarker) { userMarker.setMap(null); userMarker = null; }
          map = null; ready = false;
          if (host) { host.remove(); host = null; }
          mapEl.classList.remove('gmap');
        },
      };
    },
  };
})();
