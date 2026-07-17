/* Map provider · native (theme ui.type 1) — window.AAM_MAP_NATIVE.

   The map מסביב has always had: a bespoke proportional projection of the user
   and everything near them, distance rings, and OSM streets fitted underneath.
   Lifted out of map.html unchanged in behaviour; everything it used to read from
   that file's globals now arrives in `ctx` (see js/map/factory.js), which is what
   lets a second provider stand in its place.

   Providers implement: mount() · render() · reset() · destroy(). */
(function () {
  'use strict';

  const TILE_URL = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

  window.AAM_MAP_NATIVE = {
    id: 'native',
    create(ctx) {
      const $ = (s) => document.querySelector(s);
      const mapEl = ctx.el;

      /* ---- zoom / pan -----------------------------------------------------
         The map is a bespoke proportional projection, not a tile layer, so zoom
         is not something the library gives us: it folds into project() as a
         scale about the view centre plus a pan offset.
         Screen = (base - centre) * ZOOM + centre + PAN.
         ZOOM 1 is the fit-everything view the map has always opened at. */
      const ZMIN = 1, ZMAX = 8;
      let ZOOM = 1, PAN = { x: 0, y: 0 };
      const zClamp = (z) => Math.min(ZMAX, Math.max(ZMIN, z));

      const TILE_CACHE = new Map();      // key -> <img>, reused across renders
      let BASEMAP = localStorage.getItem('aam_basemap') !== 'off';

      /* Keep the map from being dragged off into empty space: at ZOOM 1 there is
         nothing to pan to, and beyond that you may only pan across what zooming
         actually revealed. */
      function clampPan() {
        const box = mapEl.getBoundingClientRect();
        const maxX = box.width * (ZOOM - 1) / 2;
        const maxY = box.height * (ZOOM - 1) / 2;
        PAN.x = Math.min(maxX, Math.max(-maxX, PAN.x));
        PAN.y = Math.min(maxY, Math.max(-maxY, PAN.y));
      }

      function updateZoomButtons() {
        $('#zIn').disabled = ZOOM >= ZMAX - 0.001;
        $('#zOut').disabled = ZOOM <= ZMIN + 0.001;
      }

      let lvlTimer = null;
      function showZoomLevel() {
        const el = $('#zLvl');
        el.textContent = '×' + (Math.round(ZOOM * 10) / 10);
        el.classList.add('on');
        clearTimeout(lvlTimer);
        lvlTimer = setTimeout(() => el.classList.remove('on'), 1100);
        updateZoomButtons();
      }

      /* re-render at most once per frame: a pinch fires far faster than we can
         usefully rebuild the pins */
      let zoomRaf = 0;
      function applyZoom() {
        clampPan();
        if (zoomRaf) return;
        zoomRaf = requestAnimationFrame(() => { zoomRaf = 0; if (ctx.isActive()) render(); });
        showZoomLevel();
      }

      /* Zoom about a focal point (pinch centre / cursor), so the spot under the
         fingers stays put instead of the view lurching to the middle. */
      function zoomAt(nextZ, fx, fy) {
        const box = mapEl.getBoundingClientRect();
        const cx = box.width / 2, cy = box.height / 2;
        const z0 = ZOOM, z1 = zClamp(nextZ);
        if (z1 === z0) return;
        // solve PAN so the base point under (fx,fy) maps to (fx,fy) again after zoom
        PAN.x = fx - cx - (fx - cx - PAN.x) * (z1 / z0);
        PAN.y = fy - cy - (fy - cy - PAN.y) * (z1 / z0);
        ZOOM = z1;
        if (ZOOM === ZMIN) PAN = { x: 0, y: 0 };   // snapped back to the full view
        applyZoom();
      }
      function zoomBy(f) { const b = mapEl.getBoundingClientRect(); zoomAt(ZOOM * f, b.width / 2, b.height / 2); }
      function zoomReset() { ZOOM = 1; PAN = { x: 0, y: 0 }; applyZoom(); ctx.track('map_zoom_reset'); }

      /* ---- proportional projection: bbox of user + all entities, +20% margin */
      function project() {
        const box = mapEl.getBoundingClientRect();
        const LOC = ctx.loc();
        let minLat = LOC.lat, maxLat = LOC.lat, minLng = LOC.lng, maxLng = LOC.lng;
        ctx.entities().forEach((e) => {
          minLat = Math.min(minLat, e.lat); maxLat = Math.max(maxLat, e.lat);
          minLng = Math.min(minLng, e.lng); maxLng = Math.max(maxLng, e.lng);
        });
        // 20% more than the tight bounding box (10% each side), with a minimum span
        let spanLat = Math.max(maxLat - minLat, 0.004), spanLng = Math.max(maxLng - minLng, 0.004);
        minLat -= spanLat * .1; maxLat += spanLat * .1; spanLat *= 1.2;
        minLng -= spanLng * .1; maxLng += spanLng * .1; spanLng *= 1.2;
        // keep real-world proportions (meters), letterboxing the shorter axis
        const midLat = (minLat + maxLat) / 2;
        const mW = spanLng * 111320 * Math.cos(midLat * Math.PI / 180);
        const mH = spanLat * 110540;
        const scale = Math.min(box.width / mW, box.height / mH);
        const usedW = mW * scale, usedH = mH * scale;
        const offX = (box.width - usedW) / 2, offY = (box.height - usedH) / 2;
        const metersPerPx = 1 / scale;
        // zoom about the view centre, then pan (see the ZOOM/PAN block above)
        const cx = box.width / 2, cy = box.height / 2;
        const zx = (px) => (px - cx) * ZOOM + cx + PAN.x;
        const zy = (py) => (py - cy) * ZOOM + cy + PAN.y;
        // inverses, so the basemap can ask which coordinates a screen edge sits at
        const unzx = (X) => (X - cx - PAN.x) / ZOOM + cx;
        const unzy = (Y) => (Y - cy - PAN.y) / ZOOM + cy;
        return {
          x: (lng) => zx(offX + ((lng - minLng) / spanLng) * usedW),
          y: (lat) => zy(offY + ((maxLat - lat) / spanLat) * usedH),
          lngAt: (X) => minLng + ((unzx(X) - offX) / usedW) * spanLng,
          latAt: (Y) => maxLat - ((unzy(Y) - offY) / usedH) * spanLat,
          kmToPx: (km) => ((km * 1000) / metersPerPx) * ZOOM,
          metersPerPx: metersPerPx / ZOOM,
          midLat, box,
        };
      }

      /* ---- OSM basemap ----------------------------------------------------
         Streets under the radial view, so a pin sits on a junction instead of
         floating on a grid. The pins keep their own projection; tiles are fitted
         to it.

         The subtlety: this projection is linear in latitude, tiles are Web
         Mercator (which is not). Rather than approximate, every tile is placed by
         running its own corners through project(). Adjacent tiles share a corner
         latitude, so they land on the same pixel and stay seamless — the only
         cost is a sub-pixel vertical stretch that no one can see at these spans.

         Tiles come from OpenStreetMap's public servers, whose tile usage policy
         is meant for light use — a busy production site should move to a paid
         provider or self-hosted tiles. Attribution is required and rendered
         bottom-left. */
      const lng2tile = (lng, z) => ((lng + 180) / 360) * 2 ** z;
      const lat2tile = (lat, z) => {
        const r = lat * Math.PI / 180;
        return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
      };
      const tile2lng = (x, z) => (x / 2 ** z) * 360 - 180;
      const tile2lat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180 / Math.PI;

      function renderTiles(pr) {
        const layer = ctx.tiles;
        if (!BASEMAP) { layer.innerHTML = ''; TILE_CACHE.clear(); return; }

        const W = pr.box.width, H = pr.box.height;
        // Pick the tile zoom whose native resolution is closest to ours. 156543.03392
        // is already metres *per pixel* at zoom 0 (a 256px tile spanning the globe),
        // so it must not be divided by the tile size again — doing that asks for tiles
        // 8 zoom levels too coarse, which load fine and render as a grey smear.
        const res = 156543.03392 * Math.cos(pr.midLat * Math.PI / 180);
        let z = Math.round(Math.log2(res / pr.metersPerPx));
        z = Math.max(1, Math.min(19, z));

        // which tiles cover the viewport, with one tile of bleed around it
        const west = pr.lngAt(0), east = pr.lngAt(W);
        const north = pr.latAt(0), south = pr.latAt(H);
        const x0 = Math.floor(lng2tile(west, z)) - 1, x1 = Math.ceil(lng2tile(east, z)) + 1;
        const y0 = Math.floor(lat2tile(north, z)) - 1, y1 = Math.ceil(lat2tile(south, z)) + 1;

        const n = 2 ** z;
        const need = new Set();
        // a runaway loop here would hammer OSM; the bleed makes ~40 tiles typical
        if ((x1 - x0) * (y1 - y0) > 400) return;

        for (let x = x0; x <= x1; x++) {
          for (let y = y0; y <= y1; y++) {
            if (y < 0 || y >= n) continue;              // above the pole / below it
            const wx = ((x % n) + n) % n;              // wrap the antimeridian
            const key = `${z}/${wx}/${y}`;
            need.add(key);
            let img = TILE_CACHE.get(key);
            if (!img) {
              img = new Image();
              img.className = 'tile';
              img.decoding = 'async';
              img.loading = 'eager';
              img.alt = '';
              img.src = TILE_URL(z, wx, y);
              img.addEventListener('error', () => img.classList.add('failed'), { once: true });
              TILE_CACHE.set(key, img);
              layer.appendChild(img);
            }
            // place by this tile's own corners — see the note above
            const L = pr.x(tile2lng(x, z)), R = pr.x(tile2lng(x + 1, z));
            const T = pr.y(tile2lat(y, z)), B = pr.y(tile2lat(y + 1, z));
            img.style.left = L + 'px';
            img.style.top = T + 'px';
            // +1px kills the hairline seams that rounding leaves between tiles
            img.style.width = (R - L + 1) + 'px';
            img.style.height = (B - T + 1) + 'px';
          }
        }
        // drop tiles we have scrolled away from, so the cache cannot grow forever
        for (const [key, img] of TILE_CACHE) {
          if (!need.has(key)) { img.remove(); TILE_CACHE.delete(key); }
        }
      }

      function setBasemap(on) {
        BASEMAP = on;
        localStorage.setItem('aam_basemap', on ? 'on' : 'off');
        mapEl.classList.toggle('nobase', !on);
        $('#bmBtn').setAttribute('aria-pressed', on ? 'true' : 'false');
        $('#bmBtn').textContent = on ? '🗺️' : '▦';
        ctx.track('map_basemap', on ? 'on' : 'off');
        if (ctx.isActive() && ctx.entities().length) render();
      }

      // ---------------------------------------------------------- render ----
      function render() {
        const inner = ctx.inner;
        inner.innerHTML = '';
        const LOC = ctx.loc();
        const km = ctx.radiusKm();
        const pr = project();
        renderTiles(pr);            // streets first — everything else sits on top
        // distance rings around the user
        [Math.round(km / 2 * 10) / 10, km].forEach((r_km) => {
          const r = document.createElement('div');
          r.className = 'ring';
          const d = pr.kmToPx(r_km) * 2;
          r.style.width = d + 'px'; r.style.height = d + 'px';
          r.style.left = pr.x(LOC.lng) + 'px'; r.style.top = pr.y(LOC.lat) + 'px';
          r.innerHTML = '<b>' + r_km + ' ק"מ</b>';
          inner.appendChild(r);
        });
        // me
        const me = document.createElement('div');
        me.className = 'me';
        me.style.left = pr.x(LOC.lng) + 'px'; me.style.top = pr.y(LOC.lat) + 'px';
        me.innerHTML = '<div class="dot"></div><div class="lbl">את/ה כאן</div>';
        inner.appendChild(me);
        // pins
        const entities = ctx.entities();
        const dense = entities.length > 40;
        entities.forEach((e, i) => {
          // in dense results only the 12 nearest keep the full pin + minutes label
          const p = document.createElement('button');
          p.className = 'pin' + (ctx.isDanger(e) ? ' danger' : '') + (dense && i >= 12 ? ' mini' : '');
          p.style.left = pr.x(e.lng) + 'px'; p.style.top = pr.y(e.lat) + 'px';
          p.innerHTML = '<span class="em">' + ctx.emoji(e) + '<span class="star">' + ctx.relStar(e.id)
            + '</span></span><br><span class="d">' + ctx.minutes(e.km) + ' דק׳</span>';
          p.title = e.name;
          p.onclick = () => ctx.onEntity(e);
          inner.appendChild(p);
        });
      }

      // ----------------------------------------------------------- input ----
      /* Keyboard: the map is a focusable application region, so +/-/0 and the
         arrows work once it has focus — but never steal keys from a text field. */
      const onKey = (ev) => {
        if (!ctx.isActive()) return;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable) return;
        if (ctx.modalOpen()) return;
        const step = 42;
        switch (ev.key) {
          case '+': case '=': zoomBy(1.5); break;
          case '-': case '_': zoomBy(1 / 1.5); break;
          case '0': zoomReset(); break;
          case 'm': case 'M': setBasemap(!BASEMAP); break;
          case 'ArrowUp': PAN.y += step; applyZoom(); break;
          case 'ArrowDown': PAN.y -= step; applyZoom(); break;
          case 'ArrowLeft': PAN.x += step; applyZoom(); break;
          case 'ArrowRight': PAN.x -= step; applyZoom(); break;
          default: return;
        }
        ev.preventDefault();
      };

      const onResize = () => { if (ctx.isActive() && ctx.entities().length) { clampPan(); render(); } };

      const onWheel = (ev) => {
        ev.preventDefault();
        const b = mapEl.getBoundingClientRect();
        zoomAt(ZOOM * (ev.deltaY < 0 ? 1.12 : 1 / 1.12), ev.clientX - b.left, ev.clientY - b.top);
      };

      /* Pointer Events cover touch, mouse and pen at once: one finger drags, two
         fingers pinch. We track live pointers ourselves rather than lean on
         gesturestart, which only Safari implements. */
      const pts = new Map();
      let pinchStart = null, dragged = false, captured = false;

      /* Capture only once a gesture is genuinely a drag/pinch: it guarantees we
         keep receiving moves outside the element, at the cost of stealing the click. */
      function capture(ev) {
        if (captured) return;
        try { mapEl.setPointerCapture(ev.pointerId); captured = true; } catch {}
        mapEl.classList.add('grabbing');
      }

      const onDown = (ev) => {
        if (ev.target.closest('.zoomctl')) return;      // buttons are not the canvas
        pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        dragged = false;
        if (pts.size === 2) {
          const [a, b] = [...pts.values()];
          pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: ZOOM };
        }
        /* Deliberately NOT capturing the pointer here: capture retargets the whole
           gesture to this container, so the click never reaches the pin underneath
           and every card stops opening. We only capture once a real drag/pinch begins. */
      };

      const onMove = (ev) => {
        const p = pts.get(ev.pointerId);
        if (!p) return;
        const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
        p.x = ev.clientX; p.y = ev.clientY;

        if (pts.size >= 2 && pinchStart) {
          const [a, b] = [...pts.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinchStart.dist > 0) {
            const box = mapEl.getBoundingClientRect();
            zoomAt(pinchStart.zoom * (dist / pinchStart.dist),
              (a.x + b.x) / 2 - box.left, (a.y + b.y) / 2 - box.top);
          }
          dragged = true;
          capture(ev);
        } else if (pts.size === 1 && ZOOM > ZMIN) {
          /* One finger pans, but only where zoom created somewhere to pan to, and
             only past a threshold — below it this is a tap on a pin, not a drag. */
          if (Math.abs(dx) + Math.abs(dy) < 4 && !dragged) return;
          dragged = true;
          capture(ev);
          PAN.x += dx; PAN.y += dy;
          applyZoom();
        }
      };

      const onEndPointer = (ev) => {
        pts.delete(ev.pointerId);
        if (pts.size < 2) pinchStart = null;
        if (pts.size === 0) { mapEl.classList.remove('grabbing'); captured = false; }
      };

      /* A drag that ends over a pin must not also count as tapping that pin. */
      const onClickCapture = (ev) => {
        if (dragged) { ev.stopPropagation(); ev.preventDefault(); dragged = false; }
      };

      /* double-tap / double-click to zoom in, the gesture people try first */
      const onDblClick = (ev) => {
        if (ev.target.closest('.zoomctl')) return;
        const b = mapEl.getBoundingClientRect();
        zoomAt(ZOOM * 2, ev.clientX - b.left, ev.clientY - b.top);
      };

      const zIn = () => { zoomBy(1.5); ctx.track('map_zoom', 'in'); };
      const zOut = () => { zoomBy(1 / 1.5); ctx.track('map_zoom', 'out'); };
      const bmToggle = () => setBasemap(!BASEMAP);

      return {
        id: 'native',

        mount() {
          updateZoomButtons();   // "−" starts disabled: the opening view is already zoomed out
          setBasemap(BASEMAP);   // reflect the remembered choice in the button + classes
          $('#bmBtn').addEventListener('click', bmToggle);
          $('#zIn').addEventListener('click', zIn);
          $('#zOut').addEventListener('click', zOut);
          $('#zReset').addEventListener('click', zoomReset);
          addEventListener('keydown', onKey);
          addEventListener('resize', onResize);
          mapEl.addEventListener('wheel', onWheel, { passive: false });
          mapEl.addEventListener('pointerdown', onDown);
          mapEl.addEventListener('pointermove', onMove);
          mapEl.addEventListener('pointerup', onEndPointer);
          mapEl.addEventListener('pointercancel', onEndPointer);
          mapEl.addEventListener('click', onClickCapture, true);
          mapEl.addEventListener('dblclick', onDblClick);
        },

        render,

        /* A fresh result set has a fresh bounding box — keep the old zoom and the
           user is left staring at a magnified corner of somewhere else. */
        reset() { ZOOM = 1; PAN = { x: 0, y: 0 }; updateZoomButtons(); },

        /* Symmetrical with mount(): a provider that is swapped out must leave no
           handler behind, or the next one to mount inherits a second map's worth
           of zooming and panning. */
        destroy() {
          $('#bmBtn').removeEventListener('click', bmToggle);
          $('#zIn').removeEventListener('click', zIn);
          $('#zOut').removeEventListener('click', zOut);
          $('#zReset').removeEventListener('click', zoomReset);
          removeEventListener('keydown', onKey);
          removeEventListener('resize', onResize);
          mapEl.removeEventListener('wheel', onWheel);
          mapEl.removeEventListener('pointerdown', onDown);
          mapEl.removeEventListener('pointermove', onMove);
          mapEl.removeEventListener('pointerup', onEndPointer);
          mapEl.removeEventListener('pointercancel', onEndPointer);
          mapEl.removeEventListener('click', onClickCapture, true);
          mapEl.removeEventListener('dblclick', onDblClick);
          TILE_CACHE.clear();
          ctx.tiles.innerHTML = '';
          ctx.inner.innerHTML = '';
        },
      };
    },
  };
})();
