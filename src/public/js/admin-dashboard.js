/* Dashboard admin : liste des galeries, création, mot de passe. */
(function () {
  'use strict';

  var cfg = {};
  try { cfg = JSON.parse(document.getElementById('app-config').textContent); } catch (e) {}

  function $(id) { return document.getElementById(id); }

  var banner = $('banner');
  function flash(msg, ok) {
    if (!banner) return;
    banner.textContent = msg;
    banner.className = 'banner ' + (ok ? 'ok' : 'err');
    setTimeout(function () { banner.className = 'banner hidden'; }, 3500);
  }
  if (cfg.saved) flash('Modifications enregistrées.', true);

  // ---- Liste des galeries ----
  var list = $('events-list');
  var empty = $('events-empty');
  var events = cfg.events || [];

  if (!events.length) {
    if (empty) empty.classList.remove('hidden');
  } else if (list) {
    events.forEach(function (ev) {
      var row = document.createElement('div');
      row.className = 'event-row';

      var info = document.createElement('div');
      info.className = 'event-info';

      var name = document.createElement('div');
      name.className = 'event-name';
      name.textContent = ev.name;
      info.appendChild(name);

      var meta = document.createElement('div');
      meta.className = 'event-meta muted';
      meta.textContent =
        (ev.revealed ? '● ouverte' : '○ verrouillée') +
        ' · ' + ev.count + (ev.count === 1 ? ' photo' : ' photos');
      info.appendChild(meta);

      var link = document.createElement('a');
      link.className = 'event-link';
      link.href = ev.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = ev.url;
      info.appendChild(link);

      row.appendChild(info);

      var actions = document.createElement('div');
      actions.className = 'event-actions';

      var copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'btn btn--small';
      copy.textContent = 'Copier le lien';
      copy.addEventListener('click', function () {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(ev.url).then(
            function () { flash('Lien copié.', true); },
            function () { flash('Copie impossible.', false); }
          );
        }
      });
      actions.appendChild(copy);

      var manage = document.createElement('a');
      manage.className = 'btn btn--small';
      manage.href = '/admin/events/' + encodeURIComponent(ev.slug);
      manage.textContent = 'Gérer';
      actions.appendChild(manage);

      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  // ---- Mot de passe (AJAX) ----
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
})();
