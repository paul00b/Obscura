/* Caméra invité : sélection du filtre (swipe), aperçu temps réel (vrai filtre),
   capture → filtre → upload, avec file d'attente offline. */
(function () {
  'use strict';

  var cfg = {};
  try {
    cfg = JSON.parse(document.getElementById('app-config').textContent);
  } catch (e) { cfg = {}; }

  var MAX_PHOTOS = cfg.maxPhotosPerSession && cfg.maxPhotosPerSession !== ''
    ? parseInt(cfg.maxPhotosPerSession, 10) : null;
  var MAX_SIDE = 1920;       // résolution max de la photo envoyée
  var PREVIEW_MAX = 900;     // résolution de travail du viseur filtré
  var PREVIEW_FRAME_MS = 40; // throttle des filtres (~25 fps)
  var PENDING_KEY = 'wc_pending';
  var COUNT_KEY = 'wc_count';

  var currentFilter = (cfg.filterDefault && window.Filters && window.Filters.has(cfg.filterDefault))
    ? cfg.filterDefault : 'raw';

  var REVEAL = null;
  if (cfg.revealAt) {
    var rd = new Date(cfg.revealAt);
    if (!isNaN(rd.getTime())) REVEAL = rd;
  }

  // Éléments
  var welcome = document.getElementById('welcome');
  var viewfinder = document.getElementById('viewfinder');
  var quota = document.getElementById('quota');
  var denied = document.getElementById('denied');
  var video = document.getElementById('video');
  var previewCanvas = document.getElementById('preview-canvas');
  var pctx = previewCanvas.getContext('2d');
  var canvas = document.getElementById('work-canvas');
  var flash = document.getElementById('flash');
  var shutter = document.getElementById('shutter');
  var flipBtn = document.getElementById('flip-btn');
  var toast = document.getElementById('sent-toast');
  var counterEl = document.getElementById('counter');
  var revealEl = document.getElementById('reveal-countdown');
  var pendingBadge = document.getElementById('pending-badge');
  var startBtn = document.getElementById('start-btn');
  var retryBtn = document.getElementById('retry-btn');
  var quotaMsg = document.getElementById('quota-message');
  var strip = document.getElementById('filter-strip');
  var chips = strip ? Array.prototype.slice.call(strip.querySelectorAll('.filter-chip')) : [];

  var stream = null;
  var facing = 'environment'; // 'environment' = arrière, 'user' = avant
  var localCount = parseInt(localStorage.getItem(COUNT_KEY) || '0', 10);

  // ---- Session ----
  function getSessionId() {
    var id = localStorage.getItem('wc_session');
    if (!id) {
      id = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID().replace(/-/g, '')
        : 'sxxxxxxxxxxxxxxxx'.replace(/x/g, function () {
            return Math.floor(Math.random() * 16).toString(16);
          }) + Date.now().toString(16);
      localStorage.setItem('wc_session', id);
    }
    return id;
  }
  var SESSION_ID = getSessionId();

  // ---- UI helpers ----
  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  function updateCounter() {
    if (MAX_PHOTOS == null) { hide(counterEl); return; }
    var left = Math.max(0, MAX_PHOTOS - localCount);
    counterEl.textContent = left + (left > 1 ? ' photos' : ' photo');
    show(counterEl);
  }

  // Compte à rebours jusqu'au reveal de la galerie, au format heures.minutes.
  function updateReveal() {
    if (!REVEAL) { hide(revealEl); return; }
    var diff = REVEAL.getTime() - Date.now();
    if (diff <= 0) {
      revealEl.textContent = 'Galerie ouverte';
      show(revealEl);
      return;
    }
    var totalMin = Math.floor(diff / 60000);
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    revealEl.textContent = 'Reveal dans ' + h + '.' + (m < 10 ? '0' + m : m);
    show(revealEl);
  }

  function showQuota() {
    stopPreview();
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    hide(viewfinder);
    quotaMsg.textContent = 'Tu as utilisé tes ' + (MAX_PHOTOS || '') + ' photos. Merci.';
    show(quota);
  }

  function quotaReachedLocally() {
    return MAX_PHOTOS != null && localCount >= MAX_PHOTOS;
  }

  // ---- Sélecteur de filtre ----
  function setFilter(name) {
    if (!name) return;
    currentFilter = name;
    chips.forEach(function (chip) {
      chip.classList.toggle('active', chip.dataset.filter === name);
    });
    // raw : on masque le canvas → la vidéo native (nette, plein fps) s'affiche.
    // filtre : on montre le canvas traité par-dessus.
    previewCanvas.style.opacity = name === 'raw' ? '0' : '1';
  }

  function syncFilterFromScroll() {
    if (!strip || !chips.length) return;
    var center = strip.scrollLeft + strip.clientWidth / 2;
    var best = null;
    var bestDist = Infinity;
    chips.forEach(function (chip) {
      var chipCenter = chip.offsetLeft + chip.offsetWidth / 2;
      var d = Math.abs(chipCenter - center);
      if (d < bestDist) { bestDist = d; best = chip; }
    });
    if (best && best.dataset.filter !== currentFilter) setFilter(best.dataset.filter);
  }

  function centerChip(chip, smooth) {
    if (!strip || !chip) return;
    var target = chip.offsetLeft + chip.offsetWidth / 2 - strip.clientWidth / 2;
    strip.scrollTo({ left: target, behavior: smooth ? 'smooth' : 'auto' });
  }

  if (strip) {
    var scrollTimer = null;
    strip.addEventListener('scroll', function () {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(syncFilterFromScroll, 60);
    });
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        setFilter(chip.dataset.filter);
        centerChip(chip, true);
      });
    });
  }

  // ---- Aperçu temps réel (le viseur montre le vrai filtre) ----
  var previewRunning = false;
  var lastFrame = 0;

  function sizePreview() {
    var vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return false;
    var scale = Math.min(1, PREVIEW_MAX / Math.max(vw, vh));
    var w = Math.round(vw * scale);
    var h = Math.round(vh * scale);
    if (previewCanvas.width !== w || previewCanvas.height !== h) {
      previewCanvas.width = w;
      previewCanvas.height = h;
    }
    return true;
  }

  function previewLoop(ts) {
    if (!previewRunning) return;
    requestAnimationFrame(previewLoop);
    // raw : rien à traiter, la vidéo native s'affiche directement (nette, fluide).
    if (currentFilter === 'raw') return;
    // Filtres : canvas en résolution réduite, throttlé.
    if (ts - lastFrame < PREVIEW_FRAME_MS) return;
    lastFrame = ts;
    if (!sizePreview()) return;
    pctx.drawImage(video, 0, 0, previewCanvas.width, previewCanvas.height);
    window.Filters.apply(previewCanvas, currentFilter);
  }

  function startPreview() {
    if (previewRunning) return;
    previewRunning = true;
    lastFrame = 0;
    requestAnimationFrame(previewLoop);
  }
  function stopPreview() { previewRunning = false; }

  // ---- Caméra ----
  // Acquisition : on force le bon capteur avec `exact`, repli souple si refusé
  // (ex. webcam de portable sans caméra "environment").
  function acquire(useFacing) {
    return navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { exact: useFacing } }, audio: false })
      .catch(function () {
        return navigator.mediaDevices.getUserMedia({
          video: { facingMode: useFacing },
          audio: false,
        });
      });
  }

  function attachStream(s) {
    stream = s;
    video.srcObject = s;
    var p = video.play();
    if (p && p.catch) p.catch(function () {});
    var mirror = facing === 'user';
    video.classList.toggle('mirror', mirror);
    previewCanvas.classList.toggle('mirror', mirror);
  }

  function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      hide(welcome); show(denied); return;
    }
    acquire(facing)
      .then(function (s) {
        attachStream(s);
        hide(welcome);
        hide(denied);
        show(viewfinder);
        updateCounter();
        updateReveal();
        setFilter(currentFilter);
        var active = chips.filter(function (c) { return c.dataset.filter === currentFilter; })[0];
        if (active) requestAnimationFrame(function () { centerChip(active, false); });
        startPreview();
        if (quotaReachedLocally()) showQuota();
      })
      .catch(function () { hide(welcome); show(denied); });
  }

  // Bascule caméra avant / arrière.
  function flipCamera() {
    if (!stream) return;
    if (flipBtn) flipBtn.disabled = true;
    var target = facing === 'environment' ? 'user' : 'environment';
    var previous = facing;
    facing = target;
    stream.getTracks().forEach(function (t) { t.stop(); });
    acquire(target)
      .then(function (s) { attachStream(s); startPreview(); })
      .catch(function () {
        // L'autre caméra a échoué : on rétablit la précédente.
        facing = previous;
        return acquire(previous).then(function (s) { attachStream(s); startPreview(); });
      })
      .then(
        function () { if (flipBtn) flipBtn.disabled = false; },
        function () { if (flipBtn) flipBtn.disabled = false; }
      );
  }

  // ---- Capture ----
  function fireFlash() {
    flash.classList.remove('fire');
    void flash.offsetWidth;
    flash.classList.add('fire');
  }
  function showToast() {
    toast.classList.add('show');
    setTimeout(function () { toast.classList.remove('show'); }, 900);
  }

  function capture() {
    if (!stream || quotaReachedLocally()) return;
    var vw = video.videoWidth;
    var vh = video.videoHeight;
    if (!vw || !vh) return;

    var scale = Math.min(1, MAX_SIDE / Math.max(vw, vh));
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    var ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Même filtre que l'aperçu, appliqué en pleine résolution.
    var usedFilter = currentFilter;
    window.Filters.apply(canvas, usedFilter);

    fireFlash();
    showToast();

    canvas.toBlob(function (blob) {
      if (blob) queueUpload(blob, usedFilter);
    }, 'image/jpeg', 0.9);

    localCount += 1;
    localStorage.setItem(COUNT_KEY, String(localCount));
    updateCounter();
    if (quotaReachedLocally()) setTimeout(showQuota, 600);
  }

  // ---- Upload + file d'attente offline ----
  function getPending() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function setPending(arr) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(arr)); } catch (e) {}
    updatePendingBadge();
  }
  function updatePendingBadge() {
    var n = getPending().length;
    if (n > 0) { pendingBadge.textContent = '↑ ' + n; show(pendingBadge); }
    else hide(pendingBadge);
  }
  function blobToDataURL(blob, cb) {
    var fr = new FileReader();
    fr.onload = function () { cb(fr.result); };
    fr.readAsDataURL(blob);
  }
  function dataURLToBlob(dataURL) {
    var parts = dataURL.split(',');
    var mime = parts[0].match(/:(.*?);/)[1];
    var bin = atob(parts[1]);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function queueUpload(blob, filter) {
    sendUpload(blob, filter, function (ok, data) {
      if (ok) {
        if (data && typeof data.count === 'number') {
          localCount = data.count;
          localStorage.setItem(COUNT_KEY, String(localCount));
          updateCounter();
        }
      } else if (data === 'quota_exceeded') {
        showQuota();
      } else {
        blobToDataURL(blob, function (dataURL) {
          var p = getPending();
          p.push({ data: dataURL, filter: filter, ts: Date.now() });
          setPending(p);
        });
      }
    });
  }

  function sendUpload(blob, filter, cb) {
    var fd = new FormData();
    fd.append('photo', blob, 'photo.jpg');
    fd.append('sessionId', SESSION_ID);
    fd.append('filter', filter);
    fetch('/upload', { method: 'POST', body: fd })
      .then(function (res) { return res.json().then(function (j) { return { status: res.status, body: j }; }); })
      .then(function (r) {
        if (r.status === 200 && r.body && r.body.ok) cb(true, r.body);
        else if (r.body && r.body.error === 'quota_exceeded') cb(false, 'quota_exceeded');
        else if (r.status === 429) cb(false, 'rate_limited');
        else cb(false, (r.body && r.body.error) || 'error');
      })
      .catch(function () { cb(false, 'network'); });
  }

  function flushPending() {
    var p = getPending();
    if (!p.length) return;
    var item = p[0];
    var blob = dataURLToBlob(item.data);
    var fd = new FormData();
    fd.append('photo', blob, 'photo.jpg');
    fd.append('sessionId', SESSION_ID);
    fd.append('filter', item.filter || 'raw');
    fetch('/upload', { method: 'POST', body: fd })
      .then(function (res) { return res.json().then(function (j) { return { status: res.status, body: j }; }); })
      .then(function (r) {
        if ((r.status === 200 && r.body && r.body.ok) ||
            (r.body && r.body.error === 'quota_exceeded')) {
          var arr = getPending();
          arr.shift();
          setPending(arr);
        }
      })
      .catch(function () {});
  }
  setInterval(flushPending, 5000);

  // Met l'aperçu en pause quand l'onglet est masqué (économie batterie).
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopPreview();
    else if (stream && !viewfinder.classList.contains('hidden')) startPreview();
  });

  // ---- Événements ----
  if (startBtn) startBtn.addEventListener('click', startCamera);
  if (retryBtn) retryBtn.addEventListener('click', startCamera);
  if (shutter) shutter.addEventListener('click', capture);
  if (flipBtn) flipBtn.addEventListener('click', flipCamera);

  setFilter(currentFilter);
  updatePendingBadge();
  updateReveal();
  setInterval(updateReveal, 30000);
})();
