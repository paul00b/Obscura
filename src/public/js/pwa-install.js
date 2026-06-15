/* Bandeau d'installation PWA.
   - Android : utilise l'événement beforeinstallprompt (bouton "Installer").
   - iOS : pas d'event natif → on affiche les instructions (Partager → écran d'accueil).
   Dismiss mémorisé dans localStorage pour ne pas harceler. */
(function () {
  'use strict';

  var KEY = 'wc_pwa_dismissed';
  if (localStorage.getItem(KEY)) return;

  // Déjà installée (mode autonome) → rien à proposer.
  var standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  if (standalone) return;

  var ua = navigator.userAgent || '';
  var isIOS = /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  var deferred = null;
  var bar = null;

  function dismiss() {
    if (bar) { bar.remove(); bar = null; }
    try { localStorage.setItem(KEY, '1'); } catch (e) {}
  }

  function build(innerHTML, withInstall) {
    if (bar) return;
    bar = document.createElement('div');
    bar.className = 'pwa-banner';
    bar.innerHTML =
      '<span class="pwa-text">' + innerHTML + '</span>' +
      (withInstall ? '<button type="button" class="pwa-install">Installer</button>' : '') +
      '<button type="button" class="pwa-close" aria-label="Fermer">×</button>';
    document.body.appendChild(bar);

    bar.querySelector('.pwa-close').addEventListener('click', dismiss);
    if (withInstall) {
      bar.querySelector('.pwa-install').addEventListener('click', function () {
        if (!deferred) return;
        deferred.prompt();
        deferred.userChoice.then(function () { dismiss(); });
      });
    }

    // Sur la page caméra, on retire le bandeau quand le viseur démarre
    // (sinon il chevauche les contrôles plein écran).
    var startBtn = document.getElementById('start-btn');
    if (startBtn) startBtn.addEventListener('click', function () { if (bar) bar.remove(); });
  }

  // Android / Chrome : l'event arrive quand l'app est éligible.
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    build('Installe <b>Obscura</b> sur ton téléphone pour un accès direct.', true);
  });

  // iOS Safari : instructions (pas d'install programmatique possible).
  if (isIOS) {
    build(
      'Ajoute <b>Obscura</b> à ton écran d\'accueil : appuie sur Partager puis « Sur l\'écran d\'accueil ».',
      false
    );
  }
})();
