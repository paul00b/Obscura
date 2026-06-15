import { Hono } from 'hono';
import { getConfig } from '../lib/config.js';
import { registerPhoto } from '../lib/session.js';
import { savePhoto, VALID_FILTERS } from '../lib/photos.js';

const upload = new Hono();

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Rate limiting en mémoire : 1 upload / 2s / IP.
const RATE_WINDOW_MS = 2000;
const lastUpload = new Map();

function getClientIp(c) {
  // Derrière Cloudflare Tunnel, l'IP réelle est dans CF-Connecting-IP.
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

// Nettoyage périodique de la map de rate limiting.
setInterval(() => {
  const now = Date.now();
  for (const [ip, t] of lastUpload) {
    if (now - t > 60_000) lastUpload.delete(ip);
  }
}, 60_000).unref?.();

// POST /upload → réception d'une photo
upload.post('/upload', async (c) => {
  const ip = getClientIp(c);
  if (rateLimited(ip)) {
    return c.json({ ok: false, error: 'rate_limited' }, 429);
  }

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

  if (!file || typeof file === 'string') {
    return c.json({ ok: false, error: 'no_file' }, 400);
  }
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return c.json({ ok: false, error: 'bad_type' }, 415);
  }
  if (file.size > maxBytes) {
    return c.json({ ok: false, error: 'too_large', maxBytes }, 413);
  }
  if (!VALID_FILTERS.includes(filter)) {
    filter = cfg.filterDefault || 'raw';
  }

  // Quota par session (vérifié + incrémenté atomiquement côté fichier).
  const reg = await registerPhoto(sessionId);
  if (!reg.ok) {
    if (reg.reason === 'quota_exceeded') {
      return c.json({ ok: false, error: 'quota_exceeded', count: reg.count, max: reg.max }, 403);
    }
    return c.json({ ok: false, error: reg.reason || 'session_error' }, 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const timestamp = Date.now();
  const filename = await savePhoto(buffer, filter, timestamp);

  return c.json({
    ok: true,
    filename,
    count: reg.count,
    remaining: reg.remaining,
  });
});

export default upload;
