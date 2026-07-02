/* Pull-to-refresh « vide le cache ».
   L'utilisateur tire vers le bas depuis le haut de la page et maintient :
   un décompte de 3 s s'affiche ; au bout des 3 s, on purge le Cache Storage et
   le service worker puis on recharge (assets frais). Le localStorage n'est PAS
   touché (on préserve la file d'attente de photos et la session).
   Styles injectés en JS pour être immunisé contre un styles.css périmé. */
(function () {
  'use strict';
  if (!('ontouchstart' in window)) return; // gesture tactile uniquement

  var THRESHOLD = 70;   // px de tirage pour armer le décompte
  var MAX_PULL = 150;   // tirage visuel max
  var HOLD_MS = 3000;   // durée de maintien

  // --- Style autonome ---
  var style = document.createElement('style');
  style.textContent =
    '.ptr{position:fixed;top:0;left:0;right:0;z-index:1000;display:flex;' +
    'align-items:center;justify-content:center;pointer-events:none;' +
    'font-family:Inter,-apple-system,sans-serif;transition:opacity .2s}' +
    '.ptr__pill{margin-top:14px;display:flex;align-items:center;gap:.55rem;' +
    'padding:.55rem 1rem;border-radius:999px;background:rgba(17,17,17,.95);' +
    'color:#f0ede8;font-size:.85rem;border:1px solid #2a2a2a;' +
    'box-shadow:0 8px 30px rgba(0,0,0,.45)}' +
    '.ptr__ring{width:20px;height:20px;border-radius:50%;flex:0 0 auto;' +
    'border:2px solid rgba(240,237,232,.25);border-top-color:#c8b89a;' +
    'transition:transform .1s linear}' +
    '.ptr__ring.spin{animation:ptrspin .8s linear infinite}' +
    '@keyframes ptrspin{to{transform:rotate(360deg)}}';
  document.head.appendChild(style);

  var el = null, ring = null, label = null;
  function ensureEl() {
    if (el) return;
    el = document.createElement('div');
    el.className = 'ptr';
    el.innerHTML =
      '<div class="ptr__pill"><span class="ptr__ring"></span>' +
      '<span class="ptr__label"></span></div>';
    document.body.appendChild(el);
    ring = el.querySelector('.ptr__ring');
    label = el.querySelector('.ptr__label');
  }
  function setPull(dist) {
    ensureEl();
    var d = Math.min(dist, MAX_PULL);
    el.style.transform = 'translateY(' + (d - MAX_PULL) + 'px)';
    el.style.opacity = Math.min(1, dist / THRESHOLD);
  }
  function hide() {
    if (!el) return;
    el.style.opacity = '0';
    el.style.transform = 'translateY(-' + MAX_PULL + 'px)';
  }

  var startY = 0, startX = 0, tracking = false, atTop = false;
  var armed = false, armStart = 0, timer = null, done = false;

  function scrolledTop() {
    var se = document.scrollingElement || document.documentElement;
    return (window.scrollY || 0) <= 0 && (se ? se.scrollTop <= 0 : true);
  }
  function lightboxOpen() {
    var lb = document.getElementById('lightbox');
    return lb && !lb.classList.contains('hidden');
  }

  function disarm() {
    armed = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (ring) ring.classList.remove('spin');
  }

  function arm() {
    armed = true;
    armStart = Date.now();
    tick();
    timer = setInterval(tick, 120);
  }
  function tick() {
    var left = Math.ceil((HOLD_MS - (Date.now() - armStart)) / 1000);
    if (left <= 0) { trigger(); return; }
    if (label) label.textContent = 'Maintiens pour actualiser… ' + left;
  }

  function trigger() {
    if (done) return;
    done = true;
    disarm();
    ensureEl();
    setPull(MAX_PULL);
    if (ring) ring.classList.add('spin');
    if (label) label.textContent = 'Mise à jour…';
    clearAndReload();
  }

  function clearAndReload() {
    var jobs = [];
    try {
      if (window.caches && caches.keys) {
        jobs.push(caches.keys().then(function (keys) {
          return Promise.all(keys.map(function (k) { return caches.delete(k); }));
        }));
      }
    } catch (e) {}
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        jobs.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
          return Promise.all(regs.map(function (r) { return r.unregister(); }));
        }));
      }
    } catch (e) {}
    var go = function () {
      // cache-buster pour forcer un HTML frais même si un proxy s'en mêle
      var u = location.pathname + (location.search ? location.search + '&' : '?') + '_r=' + Date.now();
      location.replace(u);
    };
    Promise.all(jobs).then(go, go);
    setTimeout(go, 1500); // filet de sécurité
  }

  document.addEventListener('touchstart', function (e) {
    if (done || e.touches.length !== 1) return;
    atTop = scrolledTop() && !lightboxOpen();
    if (!atTop) { tracking = false; return; }
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    tracking = true;
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!tracking || done) return;
    var dy = e.touches[0].clientY - startY;
    var dx = e.touches[0].clientX - startX;
    // Ignore les gestes horizontaux (ex. sélecteur de filtres, swipe lightbox).
    if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) { if (armed) disarm(); hide(); return; }
    if (!scrolledTop()) { tracking = false; disarm(); hide(); return; }
    // On empêche le rebond natif / pull-to-refresh du navigateur.
    if (e.cancelable) e.preventDefault();
    setPull(dy);
    if (dy >= THRESHOLD && !armed) arm();
    else if (dy < THRESHOLD && armed) disarm();
  }, { passive: false });

  function end() {
    if (done) return;
    tracking = false;
    disarm();
    hide();
  }
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });
})();
