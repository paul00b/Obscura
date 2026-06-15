import crypto from 'node:crypto';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

const COOKIE_NAME = 'wc_admin';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Secret signant les tokens de session admin. Régénéré à chaque démarrage :
// redémarrer le serveur invalide les sessions admin existantes (acceptable ici).
const SECRET = process.env.ADMIN_SECRET || crypto.randomBytes(32).toString('hex');

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

function makeToken() {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = `${expires}`;
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

function isTokenValid(token) {
  if (!token || typeof token !== 'string') return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload);
  // Comparaison à temps constant.
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const expires = Number(payload);
  if (Number.isNaN(expires)) return false;
  return Date.now() < expires;
}

export function startAdminSession(c) {
  const token = makeToken();
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: true, // servi en HTTPS via Cloudflare Tunnel
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function endAdminSession(c) {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
}

export function isAdmin(c) {
  const token = getCookie(c, COOKIE_NAME);
  return isTokenValid(token);
}

// Middleware Hono : protège les routes admin. Redirige vers /admin si non connecté.
export function requireAdmin(c, next) {
  if (!isAdmin(c)) {
    return c.redirect('/admin');
  }
  return next();
}
