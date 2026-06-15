import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SESSIONS_DIR, getConfig } from './config.js';

// Un sessionId est généré côté client et stocké dans localStorage.
// On le valide pour éviter le path traversal.
function isValidSessionId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(id);
}

function sessionFile(sessionId) {
  return path.join(SESSIONS_DIR, `${sessionId}.json`);
}

export async function getSession(sessionId) {
  if (!isValidSessionId(sessionId)) return null;
  try {
    const raw = await fs.readFile(sessionFile(sessionId), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Incrémente le compteur de la session. Retourne { ok, count, remaining }.
// Vérifie le quota maxPhotosPerSession avant d'autoriser.
export async function registerPhoto(sessionId) {
  if (!isValidSessionId(sessionId)) {
    return { ok: false, reason: 'invalid_session' };
  }
  const cfg = getConfig();
  const max = cfg.maxPhotosPerSession; // null = illimité

  let session = await getSession(sessionId);
  if (!session) {
    session = { count: 0, createdAt: new Date().toISOString() };
  }

  if (max != null && session.count >= max) {
    return { ok: false, reason: 'quota_exceeded', count: session.count, max };
  }

  session.count += 1;
  session.updatedAt = new Date().toISOString();
  await fs.writeFile(sessionFile(sessionId), JSON.stringify(session), 'utf8');

  return {
    ok: true,
    count: session.count,
    max,
    remaining: max == null ? null : Math.max(0, max - session.count),
  };
}

// Nombre de sessions uniques (≈ invités actifs).
export async function countSessions() {
  try {
    const files = await fs.readdir(SESSIONS_DIR);
    return files.filter((f) => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}
