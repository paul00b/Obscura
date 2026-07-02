import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.resolve(__dirname, '..', 'public');

// Fichiers dont le contenu détermine la version : dès que l'un change, la
// version change → les URLs ?v=… changent → cache navigateur / service worker
// / edge (Cloudflare) contournés automatiquement à chaque déploiement.
const FILES = [
  'css/styles.css',
  'js/camera.js',
  'js/gallery.js',
  'js/slideshow.js',
  'js/filters.js',
  'js/pwa.js',
  'js/pwa-install.js',
  'js/pull-refresh.js',
  'js/admin-dashboard.js',
  'js/admin-event.js',
];

const isDev = process.env.NODE_ENV !== 'production';
let cached = null;

export function getAssetVersion() {
  if (cached && !isDev) return cached;
  try {
    const h = crypto.createHash('sha1');
    for (const f of FILES) {
      try { h.update(readFileSync(path.join(PUB, f))); } catch { /* fichier absent */ }
    }
    cached = h.digest('hex').slice(0, 10);
  } catch {
    cached = 'dev';
  }
  return cached;
}
