import { Hono } from 'hono';
import { Readable } from 'node:stream';
import archiver from 'archiver';
import QRCode from 'qrcode';
import {
  getConfig,
  updateConfig,
  verifyAdminPassword,
  setAdminPassword,
  isRevealed,
} from '../lib/config.js';
import { renderView } from '../lib/views.js';
import {
  listPhotos,
  deletePhoto,
  isValidPhotoName,
  photoPath,
  VALID_FILTERS,
} from '../lib/photos.js';
import { countSessions } from '../lib/session.js';
import {
  isAdmin,
  startAdminSession,
  endAdminSession,
  requireAdmin,
} from '../lib/auth.js';

const admin = new Hono();

function baseUrl(c) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = c.req.header('x-forwarded-proto') || 'https';
  const host = c.req.header('host') || 'localhost';
  return `${proto}://${host}`;
}

// ---- Auth ----

// GET /admin → login (ou redirige si déjà connecté)
admin.get('/admin', async (c) => {
  if (isAdmin(c)) return c.redirect('/admin/dashboard');
  const html = await renderView('admin-login', { error: '' });
  return c.html(html);
});

// POST /admin/login
admin.post('/admin/login', async (c) => {
  const body = await c.req.parseBody();
  const password = body.password || '';
  if (verifyAdminPassword(password)) {
    startAdminSession(c);
    return c.redirect('/admin/dashboard');
  }
  const html = await renderView('admin-login', { error: 'Mot de passe incorrect.' });
  return c.html(html, 401);
});

// GET /admin/logout
admin.get('/admin/logout', (c) => {
  endAdminSession(c);
  return c.redirect('/admin');
});

// ---- Tout ce qui suit est protégé ----
admin.use('/admin/dashboard', requireAdmin);
admin.use('/admin/*', async (c, next) => {
  // /admin, /admin/login, /admin/logout déjà gérés au-dessus.
  const p = c.req.path;
  if (p === '/admin' || p === '/admin/login' || p === '/admin/logout') return next();
  return requireAdmin(c, next);
});

// GET /admin/dashboard
admin.get('/admin/dashboard', async (c) => {
  const cfg = getConfig();
  const html = await renderView('admin-dashboard', {
    eventName: cfg.eventName,
    jsonEventName: JSON.stringify(cfg.eventName),
    jsonWelcomeMessage: JSON.stringify(cfg.welcomeMessage),
    eventDate: cfg.eventDate,
    welcomeMessage: cfg.welcomeMessage,
    filterDefault: cfg.filterDefault,
    galleryLocked: cfg.galleryLocked ? 'true' : 'false',
    revealAt: cfg.revealAt,
    maxPhotosPerSession: cfg.maxPhotosPerSession ?? '',
    slideshowInterval: cfg.slideshowInterval,
    slideshowOrder: cfg.slideshowOrder,
    maxPhotoSizeMb: cfg.maxPhotoSizeMb,
    revealed: isRevealed() ? 'true' : 'false',
    publicUrl: baseUrl(c),
  });
  return c.html(html);
});

// POST /admin/config → mise à jour config (form-encoded ou JSON)
admin.post('/admin/config', async (c) => {
  let patch;
  const ct = c.req.header('content-type') || '';
  if (ct.includes('application/json')) {
    patch = await c.req.json();
  } else {
    patch = await c.req.parseBody();
    // Une checkbox non cochée n'est pas envoyée : on force la valeur.
    patch.galleryLocked = 'galleryLocked' in patch;
  }
  await updateConfig(patch);
  if (ct.includes('application/json')) return c.json({ ok: true });
  return c.redirect('/admin/dashboard?saved=1');
});

// POST /admin/password → changement de mot de passe
admin.post('/admin/password', async (c) => {
  const body = await c.req.parseBody();
  const current = body.current || '';
  const next = body.next || '';
  if (!verifyAdminPassword(current)) {
    return c.json({ ok: false, error: 'wrong_current' }, 401);
  }
  if (typeof next !== 'string' || next.length < 6) {
    return c.json({ ok: false, error: 'too_short' }, 400);
  }
  await setAdminPassword(next);
  return c.json({ ok: true });
});

// GET /admin/photos → toutes les photos (sans restriction de reveal)
admin.get('/admin/photos', async (c) => {
  const filterParam = c.req.query('filter');
  let photos = await listPhotos({ order: 'desc' });
  if (filterParam && VALID_FILTERS.includes(filterParam)) {
    photos = photos.filter((p) => p.filter === filterParam);
  }
  return c.json({
    ok: true,
    photos: photos.map((p) => ({ id: p.id, filter: p.filter, timestamp: p.timestamp })),
  });
});

// GET /admin/stats
admin.get('/admin/stats', async (c) => {
  const photos = await listPhotos({ order: 'desc' });
  const sessions = await countSessions();
  const byFilter = {};
  for (const p of photos) byFilter[p.filter] = (byFilter[p.filter] || 0) + 1;
  const last = photos[0] || null;
  return c.json({
    ok: true,
    totalPhotos: photos.length,
    uniqueSessions: sessions,
    byFilter,
    lastPhoto: last ? { id: last.id, timestamp: last.timestamp, filter: last.filter } : null,
  });
});

// GET /admin/gallery-preview → galerie telle que les invités la verront
admin.get('/admin/gallery-preview', async (c) => {
  const cfg = getConfig();
  const html = await renderView('gallery', {
    eventName: cfg.eventName,
    revealAt: cfg.revealAt,
    preview: 'true',
  });
  return c.html(html);
});

// POST /admin/delete/:id → suppression d'une photo
admin.post('/admin/delete/:id', async (c) => {
  const id = c.req.param('id');
  if (!isValidPhotoName(id)) {
    return c.json({ ok: false, error: 'invalid_id' }, 400);
  }
  const ok = await deletePhoto(id);
  return c.json({ ok });
});

// GET /admin/export → zip de toutes les photos (streamé)
admin.get('/admin/export', async (c) => {
  const photos = await listPhotos({ order: 'asc' });
  const archive = archiver('zip', { zlib: { level: 6 } });

  for (const p of photos) {
    archive.file(photoPath(p.filename), { name: p.filename });
  }
  archive.finalize();

  const webStream = Readable.toWeb(archive);
  return new Response(webStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="obscura-photos.zip"',
    },
  });
});

// GET /admin/config.json → téléchargement de la config (sans le hash)
admin.get('/admin/config.json', (c) => {
  const cfg = { ...getConfig() };
  delete cfg.adminPasswordHash;
  c.header('Content-Disposition', 'attachment; filename="config.json"');
  return c.json(cfg);
});

// GET /admin/qrcode → QR code PNG pointant vers la racine
admin.get('/admin/qrcode', async (c) => {
  const url = baseUrl(c) + '/';
  const download = c.req.query('download') === '1';
  const buf = await QRCode.toBuffer(url, {
    type: 'png',
    width: 1024,
    margin: 2,
    color: { dark: '#0A0A0A', light: '#F0EDE8' },
  });
  c.header('Content-Type', 'image/png');
  if (download) {
    c.header('Content-Disposition', 'attachment; filename="qrcode-obscura.png"');
  }
  return c.body(buf);
});

export default admin;
