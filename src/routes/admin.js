import { Hono } from 'hono';
import { Readable } from 'node:stream';
import archiver from 'archiver';
import QRCode from 'qrcode';
import { getConfig, verifyAdminPassword, setAdminPassword } from '../lib/config.js';
import {
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  isEventRevealed,
  photosDir,
  sessionsDir,
} from '../lib/events.js';
import { renderView } from '../lib/views.js';
import { listPhotos, deletePhoto, isValidPhotoName, photoPath, VALID_FILTERS } from '../lib/photos.js';
import { countSessions } from '../lib/session.js';
import { isAdmin, startAdminSession, endAdminSession, requireAdmin } from '../lib/auth.js';

const admin = new Hono();

function baseUrl(c) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = c.req.header('x-forwarded-proto') || 'https';
  const host = c.req.header('host') || 'localhost';
  return `${proto}://${host}`;
}
function eventUrl(c, slug) {
  return baseUrl(c) + '/e/' + slug;
}

// ---- Auth ----
admin.get('/admin', async (c) => {
  if (isAdmin(c)) return c.redirect('/admin/dashboard');
  const html = await renderView('admin-login', { error: '' });
  return c.html(html);
});

admin.post('/admin/login', async (c) => {
  const body = await c.req.parseBody();
  if (verifyAdminPassword(body.password || '')) {
    startAdminSession(c);
    return c.redirect('/admin/dashboard');
  }
  const html = await renderView('admin-login', { error: 'Mot de passe incorrect.' });
  return c.html(html, 401);
});

admin.get('/admin/logout', (c) => {
  endAdminSession(c);
  return c.redirect('/admin');
});

// ---- Tout le reste est protégé ----
admin.use('/admin/*', async (c, next) => {
  const p = c.req.path;
  if (p === '/admin' || p === '/admin/login' || p === '/admin/logout') return next();
  return requireAdmin(c, next);
});

// Middleware : résout l'événement pour les routes /admin/events/:slug/*
async function withEvent(c, next) {
  const ev = await getEvent(c.req.param('slug'));
  if (!ev) return c.text('Galerie introuvable.', 404);
  c.set('event', ev);
  return next();
}

// ---- Dashboard : liste des galeries + création ----
admin.get('/admin/dashboard', async (c) => {
  const events = await listEvents();
  const rows = await Promise.all(
    events.map(async (ev) => {
      const photos = await listPhotos(photosDir(ev.slug), { order: 'desc' });
      return {
        slug: ev.slug,
        name: ev.eventName,
        url: eventUrl(c, ev.slug),
        revealed: isEventRevealed(ev),
        count: photos.length,
        createdAt: ev.createdAt || '',
      };
    })
  );
  const html = await renderView('admin-dashboard', {
    jsonEvents: JSON.stringify(rows),
    saved: c.req.query('saved') ? 'true' : 'false',
  });
  return c.html(html);
});

// POST /admin/events → créer une galerie
admin.post('/admin/events', async (c) => {
  const body = await c.req.parseBody();
  const ev = await createEvent({
    eventName: (body.eventName && String(body.eventName).trim()) || 'Galerie sans nom',
    eventDate: body.eventDate || '',
    revealAt: body.revealAt || '',
    welcomeMessage: body.welcomeMessage || undefined,
    galleryLocked: 'galleryLocked' in body,
  });
  return c.redirect('/admin/events/' + ev.slug + '?created=1');
});

// POST /admin/password → mot de passe admin (global)
admin.post('/admin/password', async (c) => {
  const body = await c.req.parseBody();
  if (!verifyAdminPassword(body.current || '')) {
    return c.json({ ok: false, error: 'wrong_current' }, 401);
  }
  const next = body.next || '';
  if (typeof next !== 'string' || next.length < 6) {
    return c.json({ ok: false, error: 'too_short' }, 400);
  }
  await setAdminPassword(next);
  return c.json({ ok: true });
});

// ---- Gestion d'une galerie ----
admin.get('/admin/events/:slug', withEvent, async (c) => {
  const ev = c.get('event');
  const html = await renderView('admin-event', {
    slug: ev.slug,
    eventName: ev.eventName,
    jsonEventName: JSON.stringify(ev.eventName),
    jsonWelcomeMessage: JSON.stringify(ev.welcomeMessage),
    eventDate: ev.eventDate || '',
    welcomeMessage: ev.welcomeMessage,
    filterDefault: ev.filterDefault,
    galleryLocked: ev.galleryLocked ? 'true' : 'false',
    revealAt: ev.revealAt || '',
    maxPhotosPerSession: ev.maxPhotosPerSession ?? '',
    slideshowInterval: ev.slideshowInterval,
    slideshowOrder: ev.slideshowOrder,
    revealed: isEventRevealed(ev) ? 'true' : 'false',
    eventUrl: eventUrl(c, ev.slug),
    created: c.req.query('created') ? 'true' : 'false',
    saved: c.req.query('saved') ? 'true' : 'false',
  });
  return c.html(html);
});

admin.post('/admin/events/:slug/config', withEvent, async (c) => {
  const ev = c.get('event');
  let patch;
  const ct = c.req.header('content-type') || '';
  if (ct.includes('application/json')) {
    patch = await c.req.json();
  } else {
    patch = await c.req.parseBody();
    patch.galleryLocked = 'galleryLocked' in patch;
  }
  await updateEvent(ev.slug, patch);
  if (ct.includes('application/json')) return c.json({ ok: true });
  return c.redirect('/admin/events/' + ev.slug + '?saved=1');
});

admin.post('/admin/events/:slug/delete', withEvent, async (c) => {
  await deleteEvent(c.get('event').slug);
  return c.redirect('/admin/dashboard?saved=1');
});

admin.get('/admin/events/:slug/photos', withEvent, async (c) => {
  const ev = c.get('event');
  const filterParam = c.req.query('filter');
  let photos = await listPhotos(photosDir(ev.slug), { order: 'desc' });
  if (filterParam && VALID_FILTERS.includes(filterParam)) {
    photos = photos.filter((p) => p.filter === filterParam);
  }
  return c.json({
    ok: true,
    photos: photos.map((p) => ({ id: p.id, filter: p.filter, timestamp: p.timestamp })),
  });
});

admin.get('/admin/events/:slug/stats', withEvent, async (c) => {
  const ev = c.get('event');
  const photos = await listPhotos(photosDir(ev.slug), { order: 'desc' });
  const sessions = await countSessions(sessionsDir(ev.slug));
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

admin.post('/admin/events/:slug/delete-photo/:id', withEvent, async (c) => {
  const ev = c.get('event');
  const id = c.req.param('id');
  if (!isValidPhotoName(id)) return c.json({ ok: false, error: 'invalid_id' }, 400);
  const ok = await deletePhoto(photosDir(ev.slug), id);
  return c.json({ ok });
});

admin.get('/admin/events/:slug/export', withEvent, async (c) => {
  const ev = c.get('event');
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

admin.get('/admin/events/:slug/gallery-preview', withEvent, async (c) => {
  const ev = c.get('event');
  const html = await renderView('gallery', {
    base: '/e/' + ev.slug,
    eventName: ev.eventName,
    revealAt: ev.revealAt,
    preview: 'true',
  });
  return c.html(html);
});

admin.get('/admin/events/:slug/qrcode', withEvent, async (c) => {
  const ev = c.get('event');
  const url = eventUrl(c, ev.slug);
  const download = c.req.query('download') === '1';
  const buf = await QRCode.toBuffer(url, {
    type: 'png',
    width: 1024,
    margin: 2,
    color: { dark: '#0A0A0A', light: '#F0EDE8' },
  });
  c.header('Content-Type', 'image/png');
  if (download) c.header('Content-Disposition', `attachment; filename="qrcode-${ev.slug}.png"`);
  return c.body(buf);
});

export default admin;
