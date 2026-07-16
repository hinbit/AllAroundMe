/* Press/release animation for every interactive element.
   Default: an expanding target-rings burst (the מסביב 🎯 motif) rendered as an
   animated overlay at the press point + a squash on the element itself.
   An element may specify its own animation image with data-press-gif="url"
   (shown for ~600ms over the element while pressed / on release). */
(function () {
  'use strict';

  function isInteractive(el) {
    return el.closest('button, a, [role="button"], input[type="button"], input[type="submit"], .clickable, .chip, .card, label');
  }

  function burst(x, y, releasing) {
    const b = document.createElement('span');
    b.className = 'aam-burst' + (releasing ? ' aam-burst-out' : '');
    b.style.left = x + 'px';
    b.style.top = y + 'px';
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 650);
  }

  function gifOverlay(target, url) {
    const r = target.getBoundingClientRect();
    const img = document.createElement('img');
    img.src = url;
    img.className = 'aam-press-gif';
    img.style.left = r.left + r.width / 2 + 'px';
    img.style.top = r.top + r.height / 2 + 'px';
    document.body.appendChild(img);
    setTimeout(() => img.remove(), 650);
  }

  addEventListener('pointerdown', (e) => {
    const t = isInteractive(e.target);
    if (!t) return;
    t.classList.add('aam-pressed');
    const gif = t.dataset && t.dataset.pressGif;
    if (gif) gifOverlay(t, gif);
    else burst(e.clientX, e.clientY, false);
  }, true);

  addEventListener('pointerup', (e) => {
    const t = isInteractive(e.target);
    document.querySelectorAll('.aam-pressed').forEach((el) => el.classList.remove('aam-pressed'));
    if (!t) return;
    const gif = t.dataset && t.dataset.releaseGif;
    if (gif) gifOverlay(t, gif);
    else burst(e.clientX, e.clientY, true);
  }, true);
})();
