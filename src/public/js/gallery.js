/* Galerie publique : gestion du reveal, grille lazy, lightbox. */
(function () {
  'use strict';

  var cfg = {};
  try { cfg = JSON.parse(document.getElementById('app-config').textContent); } catch (e) {}
  var PREVIEW = cfg.preview === true;

  var lockedEl = document.getElementById('locked');
  var lockedMsg = document.getElementById('locked-message');
  var countdownEl = document.getElementById('countdown');
  var galleryEl = document.getElementById('gallery');
  var gridEl = document.getElementById('grid');
  var emptyEl = document.getElementById('empty');

  var lightbox = document.getElementById('lightbox');
  var lbImg = document.getElementById('lb-img');
  var lbClose = document.getElementById('lb-close');
  var lbPrev = document.getElementById('lb-prev');
  var lbNext = document.getElementById('lb-next');

  var photos = [];
  var currentIndex = 0;
  var revealAt = null;
  var countdownTimer = null;
  var loaded = false;

  function fmtDate(d) {
    try {
      return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) { return d.toISOString().slice(0, 10); }
  }
  function fmtTime(d) {
    try {
      return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  function renderCountdown() {
    if (!revealAt) return;
    var diff = revealAt.getTime() - Date.now();
    if (diff <= 0) { countdownEl.textContent = ''; return; }
    var h = Math.floor(diff / 3600000);
    var m = Math.floor((diff % 3600000) / 60000);
    var s = Math.floor((diff % 60000) / 1000);
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    countdownEl.textContent = pad(h) + ' : ' + pad(m) + ' : ' + pad(s);
  }

  function showLocked(revealStr) {
    if (revealStr) {
      revealAt = new Date(revealStr);
      if (!isNaN(revealAt.getTime())) {
        lockedMsg.textContent = "La galerie s'ouvre le " + fmtDate(revealAt) + ' à ' + fmtTime(revealAt) + '.';
        if (!countdownTimer) {
          renderCountdown();
          countdownTimer = setInterval(renderCountdown, 1000);
        }
      }
    }
    lockedEl.classList.remove('hidden');
    galleryEl.classList.add('hidden');
  }

  // IntersectionObserver pour le lazy-load
  var io = ('IntersectionObserver' in window)
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var item = entry.target;
            var img = item.querySelector('img');
            if (img && img.dataset.src) {
              img.src = img.dataset.src;
              img.onload = function () { item.classList.add('loaded'); };
              img.removeAttribute('data-src');
            }
            io.unobserve(item);
          }
        });
      }, { rootMargin: '300px' })
    : null;

  function buildGrid() {
    gridEl.innerHTML = '';
    if (!photos.length) { emptyEl.classList.remove('hidden'); return; }
    emptyEl.classList.add('hidden');
    photos.forEach(function (p, idx) {
      var item = document.createElement('div');
      item.className = 'grid-item' + (p.filter === 'instant' ? ' filter-instant' : '');
      var img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.dataset.src = '/photos/' + p.id;
      item.appendChild(img);
      item.addEventListener('click', function () { openLightbox(idx); });
      gridEl.appendChild(item);
      if (io) io.observe(item);
      else { img.src = img.dataset.src; item.classList.add('loaded'); }
    });
  }

  function showGallery() {
    lockedEl.classList.add('hidden');
    galleryEl.classList.remove('hidden');
    fetch('/api/photos')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.ok) { photos = j.photos || []; buildGrid(); }
      })
      .catch(function () {});
  }

  // ---- Lightbox ----
  // Photo paysage sur écran portrait → on la pivote pour la voir en grand.
  function applyOrientation() {
    var landscape = lbImg.naturalWidth > lbImg.naturalHeight;
    var portraitScreen = window.innerHeight > window.innerWidth;
    lbImg.classList.toggle('rotated', landscape && portraitScreen);
  }
  lbImg.addEventListener('load', applyOrientation);

  function showCurrent() {
    lbImg.classList.remove('rotated');
    lbImg.src = '/photos/' + photos[currentIndex].id;
  }
  function openLightbox(idx) {
    currentIndex = idx;
    showCurrent();
    lightbox.classList.remove('hidden');
  }
  function closeLightbox() { lightbox.classList.add('hidden'); lbImg.src = ''; }
  function nav(dir) {
    if (!photos.length) return;
    currentIndex = (currentIndex + dir + photos.length) % photos.length;
    showCurrent();
  }
  if (lbClose) lbClose.addEventListener('click', closeLightbox);
  if (lbPrev) lbPrev.addEventListener('click', function (e) { e.stopPropagation(); nav(-1); });
  if (lbNext) lbNext.addEventListener('click', function (e) { e.stopPropagation(); nav(1); });
  lightbox.addEventListener('click', function (e) { if (e.target === lightbox) closeLightbox(); });
  document.addEventListener('keydown', function (e) {
    if (lightbox.classList.contains('hidden')) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') nav(-1);
    else if (e.key === 'ArrowRight') nav(1);
  });
  window.addEventListener('resize', function () {
    if (!lightbox.classList.contains('hidden')) applyOrientation();
  });

  // Navigation au swipe (geste tactile) une fois la photo ouverte.
  var touchX = 0, touchY = 0;
  lightbox.addEventListener('touchstart', function (e) {
    touchX = e.changedTouches[0].clientX;
    touchY = e.changedTouches[0].clientY;
  }, { passive: true });
  lightbox.addEventListener('touchend', function (e) {
    var dx = e.changedTouches[0].clientX - touchX;
    var dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
      nav(dx < 0 ? 1 : -1); // swipe gauche → suivante
    } else if (dy > 80 && Math.abs(dy) > Math.abs(dx)) {
      closeLightbox(); // swipe vers le bas → fermer
    }
  }, { passive: true });

  // ---- Polling du statut ----
  function checkStatus(initial) {
    fetch('/api/status')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.locked) {
          if (!loaded) { loaded = true; showGallery(); }
        } else {
          showLocked(j.revealAt);
        }
      })
      .catch(function () {});
  }

  if (PREVIEW) {
    // Mode preview admin : on affiche directement la galerie invités,
    // même verrouillée (le cookie admin autorise /api/photos).
    loaded = true;
    showGallery();
  } else {
    checkStatus(true);
    // Bascule automatique au moment du reveal.
    setInterval(function () { if (!loaded) checkStatus(false); }, 30000);
  }
})();
