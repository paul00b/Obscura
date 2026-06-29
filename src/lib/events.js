import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, readLegacyConfig } from './config.js';

export const EVENTS_DIR = path.join(DATA_DIR, 'events');

// Réglages propres à chaque galerie. Chaque événement = un lien secret.
const DEFAULT_EVENT = {
  eventName: 'Nouvelle galerie',
  eventDate: '',
  revealAt: '',
  galleryLocked: true,
  filterDefault: 'raw',
  maxPhotosPerSession: null,
  welcomeMessage: 'Prends une photo, elle rejoindra la galerie.',
  slideshowInterval: 4000,
  slideshowOrder: 'random', // 'random' | 'chronological'
};

const EDITABLE_FIELDS = [
  'eventName',
  'eventDate',
  'revealAt',
  'galleryLocked',
  'filterDefault',
  'maxPhotosPerSession',
  'welcomeMessage',
  'slideshowInterval',
  'slideshowOrder',
];

const PUBLIC_FIELDS = [
  'eventName',
  'eventDate',
  'revealAt',
  'galleryLocked',
  'filterDefault',
  'maxPhotosPerSession',
  'welcomeMessage',
  'slideshowInterval',
  'slideshowOrder',
];

// Slug = jeton aléatoire non devinable (≈72 bits). C'est lui qui sert de
// contrôle d'accès : seul celui qui a le lien atteint la galerie.
const SLUG_RE = /^[A-Za-z0-9_-]{6,32}$/;

export function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug);
}

function makeSlug() {
  return crypto.randomBytes(9).toString('base64url'); // 12 caractères URL-safe
}

export function eventDir(slug) {
  return path.join(EVENTS_DIR, slug);
}
export function photosDir(slug) {
  return path.join(EVENTS_DIR, slug, 'photos');
}
export function sessionsDir(slug) {
  return path.join(EVENTS_DIR, slug, 'sessions');
}
function eventFile(slug) {
  return path.join(EVENTS_DIR, slug, 'event.json');
}

const cache = new Map();

function coerce(patch, base) {
  const out = { ...base };
  for (const key of EDITABLE_FIELDS) {
    if (!(key in patch)) continue;
    let value = patch[key];
    if (value === undefined) continue;
    if (key === 'maxPhotosPerSession' || key === 'slideshowInterval') {
      if (value === '' || value === null || value === undefined) {
        value = key === 'maxPhotosPerSession' ? null : base[key];
      } else {
        value = Number(value);
        if (Number.isNaN(value)) continue;
      }
    } else if (key === 'galleryLocked') {
      value = value === true || value === 'true' || value === 'on' || value === '1';
    }
    out[key] = value;
  }
  return out;
}

async function writeEvent(slug, data) {
  await fs.writeFile(eventFile(slug), JSON.stringify(data, null, 2), 'utf8');
  cache.set(slug, data);
}

export async function createEvent(patch = {}, opts = {}) {
  await fs.mkdir(EVENTS_DIR, { recursive: true });
  const slug = isValidSlug(opts.slug) ? opts.slug : makeSlug();
  await fs.mkdir(photosDir(slug), { recursive: true });
  await fs.mkdir(sessionsDir(slug), { recursive: true });
  const data = coerce(patch, {
    ...DEFAULT_EVENT,
    createdAt: opts.createdAt || new Date().toISOString(),
  });
  await writeEvent(slug, data);
  return { slug, ...data };
}

export async function getEvent(slug) {
  if (!isValidSlug(slug)) return null;
  if (cache.has(slug)) return { slug, ...cache.get(slug) };
  try {
    const raw = await fs.readFile(eventFile(slug), 'utf8');
    const data = { ...DEFAULT_EVENT, ...JSON.parse(raw) };
    cache.set(slug, data);
    return { slug, ...data };
  } catch {
    return null;
  }
}

export async function updateEvent(slug, patch) {
  const current = await getEvent(slug);
  if (!current) return null;
  const { slug: _omit, ...base } = current;
  const data = coerce(patch, base);
  await writeEvent(slug, data);
  return { slug, ...data };
}

export async function deleteEvent(slug) {
  if (!isValidSlug(slug)) return false;
  try {
    await fs.rm(eventDir(slug), { recursive: true, force: true });
    cache.delete(slug);
    return true;
  } catch {
    return false;
  }
}

export async function listEvents() {
  let entries;
  try {
    entries = await fs.readdir(EVENTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const events = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidSlug(entry.name)) continue;
    const ev = await getEvent(entry.name);
    if (ev) events.push(ev);
  }
  events.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return events;
}

export function eventPublic(ev) {
  const out = {};
  for (const key of PUBLIC_FIELDS) out[key] = ev[key];
  return out;
}

// Migration mono-événement → multi-événements : si aucune galerie n'existe
// mais qu'un ancien déploiement laisse un config.json et/ou des photos, on
// crée une première galerie et on y déplace les fichiers existants.
async function moveFiles(fromDir, toDir) {
  let files;
  try {
    files = await fs.readdir(fromDir);
  } catch {
    return;
  }
  await fs.mkdir(toDir, { recursive: true });
  for (const f of files) {
    try {
      await fs.rename(path.join(fromDir, f), path.join(toDir, f));
    } catch {
      /* ignore */
    }
  }
}

export async function migrateLegacyEvent() {
  const existing = await listEvents();
  if (existing.length) return null;

  const legacy = await readLegacyConfig();
  const legacyPhotos = path.join(DATA_DIR, 'photos');
  const legacySessions = path.join(DATA_DIR, 'sessions');

  let hasPhotos = false;
  try {
    hasPhotos = (await fs.readdir(legacyPhotos)).length > 0;
  } catch {
    /* pas de dossier photos legacy */
  }
  const hasEventFields = !!(legacy && legacy.eventName);
  if (!hasPhotos && !hasEventFields) return null;

  const patch = {};
  if (legacy) {
    for (const key of EDITABLE_FIELDS) {
      if (legacy[key] !== undefined) patch[key] = legacy[key];
    }
  }
  const ev = await createEvent(patch);
  await moveFiles(legacyPhotos, photosDir(ev.slug));
  await moveFiles(legacySessions, sessionsDir(ev.slug));
  console.log(`[events] Galerie existante migrée → /e/${ev.slug} ("${ev.eventName}")`);
  return ev;
}

// La galerie de cet événement est-elle révélée au public ?
export function isEventRevealed(ev) {
  if (!ev) return false;
  if (ev.galleryLocked === false) return true;
  if (!ev.revealAt) return false;
  const t = new Date(ev.revealAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() >= t;
}
