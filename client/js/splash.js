/* AllAroundMe open screen. Exposes window.AAM_SPLASH.

   The opening is data, not code: the active theme names an animation in
   client/animations/<id>.json and this file knows how to play the two shapes
   those files come in.

     textstages — an opaque card that types/reveals words on top of a hidden app,
                  and hands the app over once the last stage has played.
     simplefade — the theme's background + logo, faded up over the app and then
                  faded back off it. The app is live underneath the whole time.

   Which one is playing decides *when* the app is revealed, so callers get two
   separate hooks rather than one:
     onReveal — show the app now (start of a simplefade, end of a textstages)
     onDone   — the overlay is gone

   The server still chooses the variant per user ('full' | 'short' | 'none'), and
   ?splash= forces one for testing. */
(function () {
  'use strict';

  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const T = (key, fallback) => (window.AAM_T ? AAM_T(key) : fallback);

  function typewriter(el, text, speed) {
    return new Promise((resolve) => {
      let i = 0;
      const t = setInterval(() => {
        el.textContent = text.slice(0, ++i);
        if (i >= text.length) { clearInterval(t); resolve(); }
      }, speed);
    });
  }

  const AAM_SPLASH = {
    _done: false,
    _end: null,

    /* Resolve the variant the way the app always has: an explicit ?splash= wins,
       then reduced-motion (no movie at all), then the server's decision. */
    variant() {
      const forced = new URLSearchParams(location.search).get('splash');
      if (forced) return forced;
      if (window.AAM && AAM.reducedMotion) return 'none';
      return (window.AAM && AAM.splash) || 'full';
    },

    play({ onReveal = () => {}, onDone = () => {} } = {}) {
      const variant = this.variant();
      if (variant === 'none') { onReveal(); onDone(); return Promise.resolve(); }

      return AAM_THEME.load()
        .then(() => AAM_THEME.openScreen())
        .then((anim) => {
          // No animation, or one written in a shape we don't play: the app is the
          // point, so let it through rather than sitting on a blank overlay.
          if (!anim || !['textstages', 'simplefade'].includes(anim.type)) {
            onReveal(); onDone(); return;
          }
          const el = buildOverlay(anim);
          document.body.appendChild(el);
          if (anim.tremble) document.body.classList.add('aam-tremble');

          this._done = false;
          this._end = (why) => {
            if (this._done) return;
            this._done = true;
            document.body.classList.remove('aam-tremble');
            AAM.track('splash_' + why);
            return fadeAway(el).then(() => {
              el.remove();
              if (anim.opaque) onReveal();   // the app was hidden behind it
              onDone();
            });
          };
          wireSkip(el, anim, this._end);

          if (!anim.opaque) onReveal();      // the app dwells beneath — show it now
          const play = anim.type === 'simplefade' ? playFade : playStages;
          return play(el, anim, variant, () => this._done).then(() => this._end('done'));
        });
    },

    skip() { return this._end ? this._end('skip') : null; },
  };

  // ------------------------------------------------------------------ DOM ----
  function buildOverlay(anim) {
    const el = document.createElement('div');
    el.id = 'aam-splash';
    el.className = anim.type;
    if (anim.opaque) el.classList.add('opaque');

    if (anim.type === 'simplefade') {
      const bg = document.createElement('div');
      bg.className = 'bg';
      /* The backdrop colour is always painted, image or not: a background that
         does not cover the screen would otherwise leave the live app showing
         through the gaps instead of the brand's own colour. */
      bg.style.backgroundColor = AAM_THEME.get('colors.backdrop', '#fdfefe');
      /* `"background": null` — the brand is a mark on a plain colour, so there is
         no artwork to lay down and the backdrop is the whole background. */
      const bgSpec = anim.background;
      const bgUrl = bgSpec ? AAM_THEME.asset(bgSpec.asset || 'background') : null;
      if (bgUrl) {
        bg.style.backgroundImage = `url("${bgUrl}")`;
        bg.style.backgroundSize = bgSpec.fit || 'cover';
        bg.style.backgroundPosition = bgSpec.position || 'center';
      }
      el.appendChild(bg);

      /* `"logo": null` means the background image is already the finished card —
         mark and wordmark and all — so compositing a logo onto it would only
         print the brand twice. */
      const spec = anim.logo;
      const logoUrl = spec ? AAM_THEME.asset(spec.asset || 'logo') : null;
      if (logoUrl) {
        const img = document.createElement('img');
        img.className = 'logo';
        img.src = logoUrl;
        img.alt = AAM_THEME.get('label', '');
        img.style.left = spec.x || '50%';
        img.style.top = spec.y || '50%';
        img.style.width = spec.width || '60%';
        el.appendChild(img);
      }
    } else {
      el.innerHTML = '<div class="line1"></div><div class="line2"></div>';
    }

    if ((anim.skip || {}).buttons) el.appendChild(skipRow());
    return el;
  }

  function skipRow() {
    const row = document.createElement('div');
    row.className = 'skip-row';
    // data-i18n so the language switcher retranslates them in place, exactly as
    // it did when this markup lived in index.html
    const skip = document.createElement('button');
    skip.id = 'spSkip';
    skip.dataset.i18n = 'splash.skip';
    skip.textContent = T('splash.skip', 'דלג ›');
    skip.addEventListener('click', () => AAM_SPLASH.skip());
    const never = document.createElement('button');
    never.id = 'spNever';
    never.dataset.i18n = 'splash.never';
    never.textContent = T('splash.never', 'עזבו אותי — בלי מסך פתיחה יותר');
    never.addEventListener('click', () => {
      AAM.skipSplashForever();
      AAM_SPLASH._end('never');
    });
    row.append(skip, never);
    return row;
  }

  /* Tap-to-skip, for animations that carry no visible chrome. Only taps on the
     overlay's own surface count, so the skip buttons keep their own meaning. */
  function wireSkip(el, anim, end) {
    if (!(anim.skip || {}).tap) return;
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.skip-row')) return;
      end('skip');
    });
  }

  // -------------------------------------------------------------- players ----
  /* Fade up, hold, fade back down — one animation rather than three awaited
     steps, so a skip mid-way has a single thing to cancel. 'short' is the same
     choreography at half the length. */
  function playFade(el, anim, variant) {
    const k = variant === 'short' ? 0.5 : 1;
    const inMs = (anim.fadeInMs ?? 2500) * k;
    const hold = (anim.holdMs ?? 0) * k;
    const outMs = (anim.fadeOutMs ?? 2500) * k;
    const total = inMs + hold + outMs;

    el._anim = el.animate(
      [
        { opacity: 0, offset: 0 },
        { opacity: 1, offset: inMs / total },
        { opacity: 1, offset: (inMs + hold) / total },
        { opacity: 0, offset: 1 },
      ],
      { duration: total, easing: 'ease-in-out', fill: 'both' },
    );
    return el._anim.finished.catch(() => {});   // cancelled by a skip
  }

  function playStages(el, anim, variant, cancelled) {
    const stages = (anim.variants || {})[variant] || (anim.variants || {}).full || [];
    const line1 = el.querySelector('.line1'), line2 = el.querySelector('.line2');

    return (async () => {
      for (const st of stages) {
        if (cancelled()) return;
        if (st.type === 'type1') {
          await typewriter(line1, st.text, st.speed ?? 85);
          await pause(st.hold ?? 700);
        } else if (st.type === 'word') {
          await reveal(line2, 'word', (w) => { w.textContent = st.text + '  '; }, st.hold ?? 480);
        } else if (st.type === 'eyec') {
          // the C with a living eye in it, which later morphs into "C's"
          const w = await reveal(line2, 'word eye-c', (n) => {
            n.innerHTML = '<span class="c-char">C</span><span class="pupil"></span><span class="s-tail">’s</span>&nbsp;&nbsp;';
          }, st.look ?? 2200);
          w.classList.add('morphed');
          await pause(st.morph ?? 800);
        } else if (st.type === 'target') {
          await reveal(line2, 'word target', (w) => { w.textContent = '🎯'; }, st.hold ?? 1200);
        }
      }
    })();
  }

  function reveal(parent, cls, fill, hold) {
    const w = document.createElement('span');
    w.className = cls;
    fill(w);
    parent.appendChild(w);
    requestAnimationFrame(() => w.classList.add('on'));
    return pause(hold).then(() => w);
  }

  /* Leaving early still deserves a fade — but a short one, because the user has
     just said they are done looking at it. An animation that ran to its own end
     has already faded itself out and simply goes. */
  function fadeAway(el) {
    if (el._anim && el._anim.playState === 'finished') return Promise.resolve();
    if (el._anim) {
      // Pin the frame we were interrupted on before cancelling, or the overlay
      // snaps back to full opacity and the "exit" starts with a flash.
      el.style.opacity = getComputedStyle(el).opacity;
      el._anim.cancel();
    }
    void el.offsetHeight;                // commit that opacity before transitioning off it
    el.style.transition = 'opacity .45s';
    el.style.opacity = '0';
    return pause(450);
  }

  window.AAM_SPLASH = AAM_SPLASH;
})();
