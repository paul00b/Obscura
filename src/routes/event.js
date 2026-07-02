import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import archiver from 'archiver';
import { getConfig } from '../lib/config.js';
import {
  getEvent,
  eventPublic,
  isEventRevealed,
  photosDir,
  sessionsDir,
} from '../lib/events.js';
import { renderView } from '../lib/views.js';
import {
  listPhotos,
  savePhoto,
  isValidPhotoName,
  photoPath,
  VALID_FILTERS,
} from '../lib/photos.js';
import { registerPhoto } from '../lib/session.js';
import { isAdmin } from '../lib/auth.js';

const event = new Hono();

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Rate limiting en mémoire : 1 upload / 2s / IP.
const RATE_WINDOW_MS = 2000;
const lastUpload = new Map();
function getClientIp(c) {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
    'unknown'
  );
}
function rateLimited(ip) {
  const now = Date.now();
  const last = lastUpload.get(ip) || 0;
  if (now - last < RATE_WINDOW_MS) return true;
  lastUpload.set(ip, now);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, t] of lastUpload) {
    if (now - t > 60_000) lastUpload.delete(ip);
  }
}, 60_000).unref?.();

// CORS sur l'upload (origines configurables globalement).
event.use('/:slug/upload', (c, next) => {
  const origins = getConfig().allowedOrigins || '*';
  return cors({ origin: origins === '*' ? '*' : origins.split(',').map((o) => o.trim()) })(c, next);
});

// Résolution de l'événement : 404 si le lien n'existe pas.
event.use('/:slug', resolveEvent);
event.use('/:slug/', resolveEvent);
event.use('/:slug/*', resolveEvent);
async function resolveEvent(c, next) {
  const ev = await getEvent(c.req.param('slug'));
  if (!ev) return c.text('Galerie introuvable.', 404);
  c.set('event', ev);
  return next();
}

function base(c) {
  return '/e/' + c.get('event').slug;
}

// GET /e/:slug (et /e/:slug/ avec slash final = start_url du PWA installé)
// → page caméra invité.
async function cameraPage(c) {
  const ev = c.get('event');
  const html = await renderView('camera', {
    base: base(c),
    slug: ev.slug,
    eventName: ev.eventName,
    welcomeMessage: ev.welcomeMessage,
    filterDefault: ev.filterDefault,
    maxPhotosPerSession: ev.maxPhotosPerSession ?? '',
    revealAt: ev.revealAt ?? '',
  });
  return c.html(html);
}
event.get('/:slug', cameraPage);
event.get('/:slug/', cameraPage);

// Manifest PWA propre à la galerie (start_url = le lien de l'événement).
event.get('/:slug/manifest.webmanifest', (c) => {
  const ev = c.get('event');
  const scope = base(c) + '/';
  const manifest = {
    name: ev.eventName + ' — Photos',
    short_name: 'Photos',
    description: 'Obscura — appareil photo jetable',
    start_url: scope,
    scope,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0A0A0A',
    theme_color: '#0A0A0A',
    lang: 'fr',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
  c.header('Content-Type', 'application/manifest+json; charset=utf-8');
  return c.body(JSON.stringify(manifest));
});

// POST /e/:slug/upload → réception d'une photo
event.post('/:slug/upload', async (c) => {
  const ev = c.get('event');
  const ip = getClientIp(c);
  if (rateLimited(ip)) return c.json({ ok: false, error: 'rate_limited' }, 429);

  const cfg = getConfig();
  const maxBytes = (cfg.maxPhotoSizeMb || 8) * 1024 * 1024;

  let body;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json({ ok: false, error: 'bad_request' }, 400);
  }

  const file = body.photo;
  const sessionId = body.sessionId;
  let filter = body.filter;

  if (!file || typeof file === 'string') return c.json({ ok: false, error: 'no_file' }, 400);
  if (!ACCEPTED_TYPES.includes(file.type)) return c.json({ ok: false, error: 'bad_type' }, 415);
  if (file.size > maxBytes) return c.json({ ok: false, error: 'too_large', maxBytes }, 413);
  if (!VALID_FILTERS.includes(filter)) filter = ev.filterDefault || 'raw';

  const reg = await registerPhoto(sessionsDir(ev.slug), sessionId, ev.maxPhotosPerSession);
  if (!reg.ok) {
    if (reg.reason === 'quota_exceeded') {
      return c.json({ ok: false, error: 'quota_exceeded', count: reg.count, max: reg.max }, 403);
    }
    return c.json({ ok: false, error: reg.reason || 'session_error' }, 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = await savePhoto(photosDir(ev.slug), buffer, filter, Date.now());

  return c.json({ ok: true, filename, count: reg.count, remaining: reg.remaining });
});

// GET /e/:slug/gallery → galerie publique (bloquée avant reveal)
event.get('/:slug/gallery', async (c) => {
  const ev = c.get('event');
  const html = await renderView('gallery', {
    base: base(c),
    eventName: ev.eventName,
    revealAt: ev.revealAt,
    preview: 'false',
  });
  return c.html(html);
});

// API publique : liste des photos (uniquement après reveal, sauf admin).
event.get('/:slug/api/photos', async (c) => {
  const ev = c.get('event');
  if (!isEventRevealed(ev) && !isAdmin(c)) {
    return c.json({ ok: false, locked: true, photos: [] }, 403);
  }
  const photos = await listPhotos(photosDir(ev.slug), { order: 'desc' });
  return c.json({
    ok: true,
    photos: photos.map((p) => ({ id: p.id, filter: p.filter, timestamp: p.timestamp })),
  });
});

// Statut de la galerie : sondé par la page galerie.
event.get('/:slug/api/status', (c) => {
  const ev = c.get('event');
  return c.json({ locked: !isEventRevealed(ev), revealAt: ev.revealAt, eventName: ev.eventName });
});

// Config publique (sous-ensemble sûr) pour le client.
event.get('/:slug/api/config', (c) => c.json(eventPublic(c.get('event'))));

// GET /e/:slug/export → archive ZIP (public, uniquement après reveal)
event.get('/:slug/export', async (c) => {
  const ev = c.get('event');
  if (!isEventRevealed(ev) && !isAdmin(c)) return c.text('Forbidden', 403);
  const dir = photosDir(ev.slug);
  const photos = await listPhotos(dir, { order: 'asc' });
  const archive = archiver('zip', { zlib: { level: 6 } });
  for (const p of photos) archive.file(photoPath(dir, p.filename), { name: p.filename });
  archive.finalize();
  return new Response(Readable.toWeb(archive), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="obscura-photos.zip"',
    },
  });
});

// GET /e/:slug/photos/:filename → serving des photos (bloqué avant reveal sauf admin)
event.get('/:slug/photos/:filename', async (c) => {
  const ev = c.get('event');
  const filename = c.req.param('filename');
  if (!isValidPhotoName(filename)) return c.text('Not found', 404);
  if (!isEventRevealed(ev) && !isAdmin(c)) return c.text('Forbidden', 403);
  let data;
  try {
    data = await fs.readFile(photoPath(photosDir(ev.slug), filename));
  } catch {
    return c.text('Not found', 404);
  }
  c.header('Content-Type', 'image/jpeg');
  c.header('Cache-Control', 'private, max-age=86400');
  return c.body(data);
});

// GET /e/:slug/slideshow → diaporama plein écran (post-reveal)
event.get('/:slug/slideshow', async (c) => {
  const ev = c.get('event');
  if (!isEventRevealed(ev) && !isAdmin(c)) {
    const html = await renderView('gallery', {
      base: base(c),
      eventName: ev.eventName,
      revealAt: ev.revealAt,
      preview: 'false',
    });
    return c.html(html);
  }
  const html = await renderView('slideshow', {
    base: base(c),
    eventName: ev.eventName,
    slideshowInterval: ev.slideshowInterval,
    slideshowOrder: ev.slideshowOrder,
  });
  return c.html(html);
});

export default event;
