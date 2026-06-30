import { Hono } from 'hono';
import { getDefaultEvent } from '../lib/events.js';

// Compatibilité avec les clients d'avant le système de liens : les anciennes
// URLs racine (/, /upload, /api/*, /photos/*, …) sont redirigées vers la
// galerie par défaut (celle issue de la migration). Les onglets déjà ouverts
// et les anciens QR continuent ainsi de fonctionner après le déploiement.
const legacy = new Hono();

// Racine : galerie par défaut si elle existe, sinon l'admin.
legacy.get('/', async (c) => {
  const ev = await getDefaultEvent();
  return c.redirect(ev ? '/e/' + ev.slug : '/admin');
});

// Redirections GET (302) — réutilisent les vraies routes /e/:slug/…
const GET_PATHS = [
  '/gallery',
  '/slideshow',
  '/export',
  '/manifest.webmanifest',
  '/api/status',
  '/api/photos',
  '/api/config',
];
for (const p of GET_PATHS) {
  legacy.get(p, async (c) => {
    const ev = await getDefaultEvent();
    if (!ev) return c.text('Galerie introuvable.', 404);
    return c.redirect('/e/' + ev.slug + p);
  });
}

// Photos : /photos/:filename → /e/:slug/photos/:filename
legacy.get('/photos/:filename', async (c) => {
  const ev = await getDefaultEvent();
  if (!ev) return c.text('Not found', 404);
  return c.redirect('/e/' + ev.slug + '/photos/' + c.req.param('filename'));
});

// Upload : 307 pour conserver la méthode POST et le corps multipart.
legacy.post('/upload', async (c) => {
  const ev = await getDefaultEvent();
  if (!ev) return c.json({ ok: false, error: 'no_event' }, 404);
  return c.redirect('/e/' + ev.slug + '/upload', 307);
});

export default legacy;
