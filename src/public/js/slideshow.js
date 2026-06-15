/* Diaporama plein écran : crossfade, intervalle configurable, pause au clic. */
(function () {
  'use strict';

  var cfg = {};
  try { cfg = JSON.parse(document.getElementById('app-config').textContent); } catch (e) {}
  var INTERVAL = parseInt(cfg.slideshowInterval, 10) || 4000;
  var ORDER = cfg.slideshowOrder || 'random';

  var slideA = document.getElementById('slide-a');
  var slideB = document.getElementById('slide-b');
  var pausedEl = document.getElementById('paused');
  var emptyEl = document.getElementById('ss-empty');
  var progressBar = document.getElementById('progress-bar');

  var photos = [];
  var order = [];
  var pos = 0;
  var activeSlide = slideA;
  var inactiveSlide = slideB;
  var paused = false;
  var timer = null;
  var progStart = 0;
  var rafId = null;

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function buildOrder() {
    order = photos.map(function (_, i) { return i; });
    if (ORDER === 'random') shuffle(order);
  }

  function swap() {
    var tmp = activeSlide;
    activeSlide = inactiveSlide;
    inactiveSlide = tmp;
  }

  function next() {
    if (!photos.length) return;
    var idx = order[pos % order.length];
    pos++;
    // Recompose un ordre aléatoire à chaque tour complet.
    if (pos % order.length === 0 && ORDER === 'random') buildOrder();

    var p = photos[idx];
    inactiveSlide.onload = function () {
      inactiveSlide.classList.add('active');
      activeSlide.classList.remove('active');
      swap();
    };
    inactiveSlide.src = '/photos/' + p.id;
    resetProgress();
  }

  function resetProgress() {
    progStart = Date.now();
  }
  function tickProgress() {
    if (!paused) {
      var elapsed = Date.now() - progStart;
      var pct = Math.min(100, (elapsed / INTERVAL) * 100);
      progressBar.style.width = pct + '%';
    }
    rafId = requestAnimationFrame(tickProgress);
  }

  function start() {
    if (timer) clearInterval(timer);
    next();
    timer = setInterval(function () { if (!paused) next(); }, INTERVAL);
    if (!rafId) tickProgress();
  }

  function togglePause() {
    paused = !paused;
    if (paused) {
      pausedEl.classList.remove('hidden');
    } else {
      pausedEl.classList.add('hidden');
      resetProgress();
    }
  }

  document.addEventListener('click', togglePause);

  fetch('/api/photos')
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (j.ok && j.photos && j.photos.length) {
        photos = ORDER === 'chronological' ? j.photos.slice().reverse() : j.photos;
        buildOrder();
        start();
      } else {
        emptyEl.classList.remove('hidden');
      }
    })
    .catch(function () { emptyEl.classList.remove('hidden'); });
})();
