/* Modale d'incitation à l'installation PWA.
   - S'affiche à chaque connexion TANT QUE l'utilisateur n'a pas cliqué « Non merci »
     (une fermeture douce ×/fond ne mémorise rien → la modale revient).
   - Android/Chrome : bouton « Installer » → déclenche l'ajout à l'écran d'accueil
     via l'événement beforeinstallprompt.
   - iOS/Safari : pas de déclenchement possible → on affiche les instructions
     (Partager → « Sur l'écran d'accueil »). */
(function () {
  'use strict';

  // Clé de refus, cloisonnée par galerie (chaque lien = une app installable).
  var m = location.pathname.match(/\/e\/([A-Za-z0-9_-]+)/);
  var slug = m ? m[1] : '';
  var KEY = 'wc_pwa_no' + (slug ? ':' + slug : '');

  // Déjà refusée définitivement, ou déjà installée (mode autonome) → rien.
  try { if (localStorage.getItem(KEY)) return; } catch (e) {}
  var standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  if (standalone) return;

  var ua = navigator.userAgent || '';
  var isIOS = /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  var deferred = null;
  var modal = null;

  function refuse() {           // « Non merci » → on ne reproposera plus
    try { localStorage.setItem(KEY, '1'); } catch (e) {}
    close();
  }
  function close() {            // fermeture douce → réapparaîtra la prochaine fois
    if (modal) { modal.remove(); modal = null; }
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function show(opts) {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'pwa-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    var actions = opts.canInstall
      ? '<button type="button" class="btn pwa-modal__install">Installer l\'app</button>'
      : '';

    modal.innerHTML =
      '<div class="pwa-modal__backdrop"></div>' +
      '<div class="pwa-modal__card">' +
        '<button type="button" class="pwa-modal__x" aria-label="Fermer">×</button>' +
        '<img class="pwa-modal__icon" src="/icons/icon-192.png" alt="" />' +
        '<h2 class="pwa-modal__title">' + opts.title + '</h2>' +
        '<p class="pwa-modal__text">' + opts.text + '</p>' +
        '<div class="pwa-modal__actions">' +
          actions +
          '<button type="button" class="pwa-modal__no">Non merci</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    modal.querySelector('.pwa-modal__backdrop').addEventListener('click', close);
    modal.querySelector('.pwa-modal__x').addEventListener('click', close);
    modal.querySelector('.pwa-modal__no').addEventListener('click', refuse);
    document.addEventListener('keydown', onKey);

    if (opts.canInstall) {
      modal.querySelector('.pwa-modal__install').addEventListener('click', function () {
        if (!deferred) return;
        deferred.prompt();
        deferred.userChoice.then(function (choice) {
          // Accepté → installée, on ne repropose plus. Refusé au niveau natif →
          // fermeture douce (la modale pourra revenir plus tard).
          if (choice && choice.outcome === 'accepted') refuse();
          else close();
          deferred = null;
        });
      });
    }
  }

  // Android / Chrome : l'event arrive quand l'app est éligible → on peut installer.
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    show({
      canInstall: true,
      title: 'Installe l\'app',
      text: 'Ajoute <b>Obscura</b> à ton écran d\'accueil pour ouvrir l\'appareil photo en un tap, comme une vraie app.',
    });
  });

  // iOS Safari : instructions (installation programmatique impossible).
  if (isIOS) {
    show({
      canInstall: false,
      title: 'Ajoute l\'app à ton écran',
      text: 'Appuie sur le bouton <b>Partager</b> en bas de Safari, puis choisis ' +
            '« <b>Sur l\'écran d\'accueil</b> » pour installer <b>Obscura</b>.',
    });
  }
})();
