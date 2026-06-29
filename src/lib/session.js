import { promises as fs } from 'node:fs';
import path from 'node:path';

// Un sessionId est généré côté client et stocké dans localStorage.
// On le valide pour éviter le path traversal.
function isValidSessionId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(id);
}

function sessionFile(dir, sessionId) {
  return path.join(dir, `${sessionId}.json`);
}

export async function getSession(dir, sessionId) {
  if (!isValidSessionId(sessionId)) return null;
  try {
    const raw = await fs.readFile(sessionFile(dir, sessionId), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Incrémente le compteur de la session. Retourne { ok, count, remaining }.
// Vérifie le quota `max` (null = illimité) avant d'autoriser.
export async function registerPhoto(dir, sessionId, max) {
  if (!isValidSessionId(sessionId)) {
    return { ok: false, reason: 'invalid_session' };
  }

  let session = await getSession(dir, sessionId);
  if (!session) {
    session = { count: 0, createdAt: new Date().toISOString() };
  }

  if (max != null && session.count >= max) {
    return { ok: false, reason: 'quota_exceeded', count: session.count, max };
  }

  session.count += 1;
  session.updatedAt = new Date().toISOString();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(sessionFile(dir, sessionId), JSON.stringify(session), 'utf8');

  return {
    ok: true,
    count: session.count,
    max,
    remaining: max == null ? null : Math.max(0, max - session.count),
  };
}

// Nombre de sessions uniques (≈ invités actifs) pour un événement.
export async function countSessions(dir) {
  try {
    const files = await fs.readdir(dir);
    return files.filter((f) => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}
