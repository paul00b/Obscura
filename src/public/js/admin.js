/* Dashboard admin : préremplissage, stats, modération, mot de passe. */
(function () {
  'use strict';

  var cfg = {};
  try { cfg = JSON.parse(document.getElementById('app-config').textContent); } catch (e) {}

  function $(id) { return document.getElementById(id); }
  function val(id, v) { var el = $(id); if (el != null && v != null) el.value = v; }

  // ---- Préremplissage des formulaires ----
  val('f-eventName', cfg.eventName);
  val('f-eventDate', cfg.eventDate);
  val('f-welcome', cfg.welcomeMessage);
  val('f-filter', cfg.filterDefault);
  val('f-revealAt', toLocalInput(cfg.revealAt));
  val('f-maxPhotos', cfg.maxPhotosPerSession);
  val('f-ssInterval', cfg.slideshowInterval);
  val('f-ssOrder', cfg.slideshowOrder);
  val('f-maxSize', cfg.maxPhotoSizeMb);
  if ($('f-galleryLocked')) $('f-galleryLocked').checked = cfg.galleryLocked === true;

  // datetime-local attend "YYYY-MM-DDTHH:mm"
  function toLocalInput(s) {
    if (!s) return '';
    // on garde tel quel si déjà au bon format
    var m = String(s).match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
    return m ? m[1] : '';
  }

  // Slider : affichage de la valeur
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

  // ---- QR url ----
  if ($('qr-url')) $('qr-url').textContent = (cfg.publicUrl || '') + '/';

  // ---- Bannière de feedback (?saved=1) ----
  var banner = $('banner');
  function flash(msg, ok) {
    if (!banner) return;
    banner.textContent = msg;
    banner.className = 'banner ' + (ok ? 'ok' : 'err');
    setTimeout(function () { banner.className = 'banner hidden'; }, 3500);
  }
  if (location.search.indexOf('saved=1') !== -1) flash('Modifications enregistrées.', true);

  // ---- Stats ----
  function loadStats() {
    fetch('/admin/stats').then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return;
      $('stat-photos').textContent = j.totalPhotos;
      $('stat-sessions').textContent = j.uniqueSessions;
      if (j.lastPhoto) {
        var d = new Date(j.lastPhoto.timestamp);
        $('stat-last').textContent = d.toLocaleString('fr-FR');
        var thumb = $('stat-last-thumb');
        thumb.src = '/photos/' + j.lastPhoto.id;
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
    var url = '/admin/photos' + (f ? '?filter=' + encodeURIComponent(f) : '');
    fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      modGrid.innerHTML = '';
      if (!j.ok || !j.photos.length) { modEmpty.classList.remove('hidden'); return; }
      modEmpty.classList.add('hidden');
      j.photos.forEach(function (p) {
        var item = document.createElement('div');
        item.className = 'mod-item';

        var img = document.createElement('img');
        img.src = '/photos/' + p.id;
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
    fetch('/admin/delete/' + encodeURIComponent(id), { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.ok) { el.remove(); loadStats(); }
        else flash('Suppression impossible.', false);
      })
      .catch(function () { flash('Erreur réseau.', false); });
  }

  if (modFilter) modFilter.addEventListener('change', loadPhotos);
  if ($('mod-refresh')) $('mod-refresh').addEventListener('click', function () { loadPhotos(); loadStats(); });

  // Les formulaires de config sont postés normalement (POST /admin/config),
  // le serveur redirige vers ?saved=1 et la bannière s'affiche.

  // ---- Changement de mot de passe (AJAX) ----
  var pwForm = $('password-form');
  if (pwForm) {
    pwForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(pwForm);
      fetch('/admin/password', { method: 'POST', body: fd })
        .then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
        .then(function (res) {
          if (res.j.ok) { flash('Mot de passe modifié.', true); pwForm.reset(); }
          else if (res.j.error === 'wrong_current') flash('Mot de passe actuel incorrect.', false);
          else if (res.j.error === 'too_short') flash('Nouveau mot de passe trop court (6+).', false);
          else flash('Erreur.', false);
        })
        .catch(function () { flash('Erreur réseau.', false); });
    });
  }

  loadStats();
  loadPhotos();
})();
