import { Hono } from 'hono';
import { promises as fs } from 'node:fs';
import { getPublicConfig, isRevealed } from '../lib/config.js';
import { renderView } from '../lib/views.js';
import { listPhotos, isValidPhotoName, photoPath } from '../lib/photos.js';
import { isAdmin } from '../lib/auth.js';

const gallery = new Hono();

// GET /gallery → galerie publique (bloquée avant reveal)
gallery.get('/gallery', async (c) => {
  const cfg = getPublicConfig();
  const html = await renderView('gallery', {
    eventName: cfg.eventName,
    revealAt: cfg.revealAt,
    preview: 'false',
  });
  return c.html(html);
});

// API publique : liste des photos (uniquement après reveal, sauf admin).
gallery.get('/api/photos', async (c) => {
  if (!isRevealed() && !isAdmin(c)) {
    return c.json({ ok: false, locked: true, photos: [] }, 403);
  }
  const photos = await listPhotos({ order: 'desc' });
  return c.json({
    ok: true,
    photos: photos.map((p) => ({ id: p.id, filter: p.filter, timestamp: p.timestamp })),
  });
});

// GET /photos/:filename → serving des photos (bloqué avant reveal sauf admin)
gallery.get('/photos/:filename', async (c) => {
  const filename = c.req.param('filename');
  if (!isValidPhotoName(filename)) {
    return c.text('Not found', 404);
  }
  if (!isRevealed() && !isAdmin(c)) {
    return c.text('Forbidden', 403);
  }
  let data;
  try {
    data = await fs.readFile(photoPath(filename));
  } catch {
    return c.text('Not found', 404);
  }
  c.header('Content-Type', 'image/jpeg');
  c.header('Cache-Control', 'private, max-age=86400');
  return c.body(data);
});

export default gallery;
