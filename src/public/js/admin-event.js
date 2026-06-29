/* Gestion d'une galerie : préremplissage, stats, modération, lien/QR. */
(function () {
  'use strict';

  var cfg = {};
  try { cfg = JSON.parse(document.getElementById('app-config').textContent); } catch (e) {}

  var ADMIN = cfg.base || '';                 // /admin/events/<slug>
  var PHOTOS = '/e/' + (cfg.slug || '');       // sert les vignettes (admin = autorisé avant reveal)

  function $(id) { return document.getElementById(id); }
  function val(id, v) { var el = $(id); if (el != null && v != null) el.value = v; }

  function toLocalInput(s) {
    if (!s) return '';
    var m = String(s).match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
    return m ? m[1] : '';
  }

  // ---- Préremplissage ----
  val('f-eventName', cfg.eventName);
  val('f-eventDate', cfg.eventDate);
  val('f-welcome', cfg.welcomeMessage);
  val('f-filter', cfg.filterDefault);
  val('f-revealAt', toLocalInput(cfg.revealAt));
  val('f-maxPhotos', cfg.maxPhotosPerSession);
  val('f-ssInterval', cfg.slideshowInterval);
  val('f-ssOrder', cfg.slideshowOrder);
  if ($('f-galleryLocked')) $('f-galleryLocked').checked = cfg.galleryLocked === true;

  // Slider
  var ssVal = $('ss-val');
  var ssInput = $('f-ssInterval');
  function refreshSsVal() { if (ssVal && ssInput) ssVal.textContent = ssInput.value; }
  if (ssInput) { ssInput.addEventListener('input', refreshSsVal); refreshSsVal(); }

  // ---- État du reveal ----
  var revealStateEl = $('reveal-state');
  if (revealStateEl) {
    if (cfg.revealed) {
      revealStateEl.textContent = '● Galerie OUVERTE — visible par les invités.';
      revealStateEl.classList.add('open');
    } else {
      revealStateEl.textContent = '○ Galerie verrouillée — invisible pour les invités.';
    }
  }

  // ---- Lien à partager ----
  if ($('event-url')) $('event-url').textContent = cfg.eventUrl || '';
  var copyBtn = $('copy-link');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      if (navigator.clipboard && cfg.eventUrl) {
        navigator.clipboard.writeText(cfg.eventUrl).then(
          function () { flash('Lien copié.', true); },
          function () { flash('Copie impossible.', false); }
        );
      }
    });
  }

  // ---- Bannière ----
  var banner = $('banner');
  function flash(msg, ok) {
    if (!banner) return;
    banner.textContent = msg;
    banner.className = 'banner ' + (ok ? 'ok' : 'err');
    setTimeout(function () { banner.className = 'banner hidden'; }, 3500);
  }
  if (cfg.created) flash('Galerie créée — partage le lien ci-dessus.', true);
  else if (cfg.saved) flash('Modifications enregistrées.', true);

  // ---- Suppression de la galerie (confirmation) ----
  var delForm = $('delete-form');
  if (delForm) {
    delForm.addEventListener('submit', function (e) {
      if (!confirm('Supprimer définitivement cette galerie et toutes ses photos ?')) {
        e.preventDefault();
      }
    });
  }

  // ---- Stats ----
  function loadStats() {
    fetch(ADMIN + '/stats').then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return;
      $('stat-photos').textContent = j.totalPhotos;
      $('stat-sessions').textContent = j.uniqueSessions;
      if (j.lastPhoto) {
        var d = new Date(j.lastPhoto.timestamp);
        $('stat-last').textContent = d.toLocaleString('fr-FR');
        var thumb = $('stat-last-thumb');
        thumb.src = PHOTOS + '/photos/' + j.lastPhoto.id;
        thumb.classList.remove('hidden');
      } else {
        $('stat-last').textContent = 'aucune';
      }
    }).catch(function () {});
  }

  // ---- Modération ----
  var modGrid = $('mod-grid');
  var modEmpty = $('mod-empty');
  var modFilter = $('mod-filter');

  function loadPhotos() {
    var f = modFilter ? modFilter.value : '';
    var url = ADMIN + '/photos' + (f ? '?filter=' + encodeURIComponent(f) : '');
    fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      modGrid.innerHTML = '';
      if (!j.ok || !j.photos.length) { modEmpty.classList.remove('hidden'); return; }
      modEmpty.classList.add('hidden');
      j.photos.forEach(function (p) {
        var item = document.createElement('div');
        item.className = 'mod-item';

        var img = document.createElement('img');
        img.src = PHOTOS + '/photos/' + p.id;
        img.loading = 'lazy';
        item.appendChild(img);

        var tag = document.createElement('span');
        tag.className = 'mod-item__filter';
        tag.textContent = p.filter;
        item.appendChild(tag);

        var del = document.createElement('button');
        del.className = 'mod-item__del';
        del.textContent = '×';
        del.title = 'Supprimer';
        del.addEventListener('click', function () { deletePhoto(p.id, item); });
        item.appendChild(del);

        modGrid.appendChild(item);
      });
    }).catch(function () {});
  }

  function deletePhoto(id, el) {
    if (!confirm('Supprimer définitivement cette photo ?')) return;
    fetch(ADMIN + '/delete-photo/' + encodeURIComponent(id), { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.ok) { el.remove(); loadStats(); }
        else flash('Suppression impossible.', false);
      })
      .catch(function () { flash('Erreur réseau.', false); });
  }

  if (modFilter) modFilter.addEventListener('change', loadPhotos);
  if ($('mod-refresh')) $('mod-refresh').addEventListener('click', function () { loadPhotos(); loadStats(); });

  loadStats();
  loadPhotos();
})();
