/* AllAroundMe sound engine.
   - Synthesized click on press + softer tick on release for every interactive element.
   - Per-page ambient music, chosen with <body data-ambience="...">:
       (not declared)        -> the track library, /assets/audio/tracks.json
       ""                    -> silence
       "/path/tracks.json"   -> that library: one track at random, another when it ends
       "/path/track.mp3"     -> that single track, looped
       "generative"          -> the synthesized pad (see startGenerativeAmbience)
     Any element can switch the ambience with data-ambience on itself.
   - Floating volume widget: ambience volume slider + global mute toggle,
     persisted in localStorage. One control for all of the above. */
(function () {
  'use strict';

  const store = {
    get muted() { return localStorage.getItem('aam_muted') === '1'; },
    set muted(v) { localStorage.setItem('aam_muted', v ? '1' : '0'); },
    get volume() { return Math.min(1, Math.max(0, parseFloat(localStorage.getItem('aam_volume') ?? '0.35'))); },
    set volume(v) { localStorage.setItem('aam_volume', String(v)); },
  };

  let ctx = null, master = null, ambGain = null, ambNodes = [], ambAudio = null;

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = store.muted ? 0 : 1;
    master.connect(ctx.destination);
    ambGain = ctx.createGain();
    ambGain.gain.value = store.volume;
    ambGain.connect(master);
    return ctx;
  }

  // -- UI click sounds --------------------------------------------------------
  function blip(freq, dur, gain, type) {
    if (store.muted || !ensureCtx()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, ctx.currentTime + dur);
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(master);
    o.start(); o.stop(ctx.currentTime + dur);
  }
  const pressSound = () => blip(660, 0.08, 0.12, 'triangle');
  const releaseSound = () => blip(440, 0.12, 0.07, 'sine');

  // -- ambient music ----------------------------------------------------------
  // generative pad: two slow detuned oscillators + LFO — a quiet wave-like hum
  function startGenerativeAmbience(seed) {
    stopAmbience();
    if (!ensureCtx()) return;
    const base = 110 + ((seed || 0) % 4) * 18;
    for (const [mult, vol] of [[1, 0.05], [1.5, 0.028], [2.01, 0.017]]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = base * mult;
      g.gain.value = vol;
      const lfo = ctx.createOscillator();
      const lfoG = ctx.createGain();
      lfo.frequency.value = 0.05 + Math.random() * 0.08;
      lfoG.gain.value = vol * 0.6;
      lfo.connect(lfoG); lfoG.connect(g.gain);
      o.connect(g); g.connect(ambGain);
      o.start(); lfo.start();
      ambNodes.push(o, lfo);
    }
  }

  function newAmbAudio() {
    const a = new Audio();
    /* preload='none', not the default 'auto': 'auto' pulls the whole track down
       on page load, competing with the map tiles for a phone's bandwidth. A
       muted visitor then transfers nothing at all. Note we never call load(),
       which would force the fetch and defeat this — setting src is enough. */
    a.preload = 'none';
    a.volume = store.muted ? 0 : store.volume;
    return a;
  }

  function startMp3Ambience(src) {
    stopAmbience();
    ambAudio = newAmbAudio();
    ambAudio.loop = true;
    ambAudio.src = src;
    ambAudio.play().catch(() => {});
  }

  // -- track library ----------------------------------------------------------
  // One track at random, then a different one when it ends: the loop is over the
  // library rather than over a single file.
  let LIB = [], libLast = -1, libBase = '';

  function pickLib() {
    if (LIB.length < 2) return 0;
    let i;
    do { i = Math.floor(Math.random() * LIB.length); } while (i === libLast);
    return i;
  }

  function playNextFromLib() {
    if (!ambAudio || !LIB.length) return;
    libLast = pickLib();
    ambAudio.src = libBase + LIB[libLast].file;
    ambAudio.play().catch(() => {});   // autoplay may be blocked; firstGesture retries
  }

  async function startLibraryAmbience(url) {
    stopAmbience();
    libBase = url.replace(/[^/]*$/, '');
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) return;                       // no library deployed -> silence
      const list = await res.json();
      LIB = Array.isArray(list) ? list.filter((t) => t && t.file) : [];
    } catch (e) { LIB = []; }
    if (!LIB.length) return;                     // nothing to play, and no pad
    ambAudio = newAmbAudio();
    ambAudio.addEventListener('ended', playNextFromLib);
    // a track that 404s must not kill the library: drop it and move on
    ambAudio.addEventListener('error', () => {
      if (libLast >= 0) LIB.splice(libLast, 1);
      libLast = -1;
      if (LIB.length) playNextFromLib();
    });
    playNextFromLib();
  }

  function stopAmbience() {
    for (const n of ambNodes) { try { n.stop(); } catch (e) { /* already stopped */ } }
    ambNodes = [];
    if (ambAudio) { ambAudio.pause(); ambAudio = null; }
  }

  const DEFAULT_LIBRARY = '/assets/audio/tracks.json';

  function setAmbience(src) {
    if (src === '' || src == null) { stopAmbience(); return; }   // declared silent
    if (/\.json(\?|$)/.test(src)) { startLibraryAmbience(src); return; }
    if (/\.(mp3|ogg|wav)(\?|$)/.test(src)) { startMp3Ambience(src); return; }
    /* The pad is opt-in now. It used to be the default for every page, which put
       a sustained 110-176Hz drone under everything — inaudible as intended on
       desktop speakers, but a phone cannot reproduce those frequencies and
       renders them as a buzz that reads as static. */
    if (src === 'generative') { startGenerativeAmbience(location.pathname.length); return; }
    startGenerativeAmbience(src.length);
  }

  function applyVolume() {
    if (ambGain) ambGain.gain.value = store.volume;
    if (ambAudio) ambAudio.volume = store.muted ? 0 : store.volume;
    if (master) master.gain.value = store.muted ? 0 : 1;
  }

  // -- floating volume / mute widget -----------------------------------------
  function widget() {
    const el = document.createElement('div');
    el.className = 'aam-sound-widget';
    el.innerHTML = `
      <button class="aam-mute" title="השתקה כללית" aria-label="השתקה">${store.muted ? '🔇' : '🔊'}</button>
      <input class="aam-vol" type="range" min="0" max="100" value="${Math.round(store.volume * 100)}" title="עוצמת מוסיקת רקע">`;
    document.body.appendChild(el);
    const muteBtn = el.querySelector('.aam-mute');
    muteBtn.addEventListener('click', () => {
      store.muted = !store.muted;
      muteBtn.textContent = store.muted ? '🔇' : '🔊';
      applyVolume();
      if (window.AAM) AAM.track('sound_mute', null, { muted: store.muted });
    });
    el.querySelector('.aam-vol').addEventListener('input', (e) => {
      store.volume = e.target.value / 100;
      applyVolume();
    });
  }

  // -- global wiring ----------------------------------------------------------
  let ambStarted = false;
  function firstGesture() {
    if (ambStarted) return;
    ambStarted = true;
    if (store.muted) return;
    /* undefined = the page declared nothing -> the library; "" = declared silent.
       `|| ''` used to collapse those two, so doctor.html's data-ambience=""
       asked for silence and got the pad anyway. */
    const declared = document.body.dataset.ambience;
    setAmbience(declared === undefined ? DEFAULT_LIBRARY : declared);
  }

  function isInteractive(el) {
    return el.closest('button, a, [role="button"], input[type="button"], input[type="submit"], .clickable, .chip, .card, select, label');
  }

  addEventListener('pointerdown', (e) => {
    firstGesture();
    const t = isInteractive(e.target);
    if (!t) return;
    pressSound();
    const amb = t.dataset && t.dataset.ambience;
    if (amb !== undefined && amb !== '') setAmbience(amb);
  }, true);

  addEventListener('pointerup', (e) => {
    if (isInteractive(e.target)) releaseSound();
  }, true);

  document.addEventListener('DOMContentLoaded', widget);

  window.AAMSound = { setAmbience, get muted() { return store.muted; } };
})();
