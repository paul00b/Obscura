import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PHOTOS_DIR } from './config.js';

const VALID_FILTERS = ['grain', 'fade', 'noir', 'instant', 'raw'];

// Nom de fichier : [uuid]-[timestamp].[filtre].jpg
// ex: 3f2a...e1-1718467200000.grain.jpg
export function buildFilename(filter, timestamp) {
  const safeFilter = VALID_FILTERS.includes(filter) ? filter : 'raw';
  const uuid = crypto.randomUUID();
  return `${uuid}-${timestamp}.${safeFilter}.jpg`;
}

// Empêche tout path traversal : on n'accepte que des noms produits par nous.
const FILENAME_RE = /^[0-9a-f-]{36}-\d{10,16}\.(grain|fade|noir|instant|raw)\.jpg$/;

export function isValidPhotoName(name) {
  return typeof name === 'string' && FILENAME_RE.test(name);
}

function parseMeta(filename) {
  const m = filename.match(/^([0-9a-f-]{36})-(\d{10,16})\.([a-z]+)\.jpg$/);
  if (!m) return null;
  return {
    filename,
    id: filename, // l'id public = le nom de fichier complet
    uuid: m[1],
    timestamp: Number(m[2]),
    filter: m[3],
  };
}

// Liste toutes les photos, triées (récent -> ancien par défaut).
export async function listPhotos({ order = 'desc' } = {}) {
  let files;
  try {
    files = await fs.readdir(PHOTOS_DIR);
  } catch {
    return [];
  }
  const photos = files
    .map(parseMeta)
    .filter(Boolean)
    .sort((a, b) => (order === 'asc' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp));
  return photos;
}

export async function savePhoto(buffer, filter, timestamp) {
  const filename = buildFilename(filter, timestamp);
  await fs.writeFile(path.join(PHOTOS_DIR, filename), buffer);
  return filename;
}

export async function deletePhoto(filename) {
  if (!isValidPhotoName(filename)) return false;
  try {
    await fs.unlink(path.join(PHOTOS_DIR, filename));
    return true;
  } catch {
    return false;
  }
}

export function photoPath(filename) {
  return path.join(PHOTOS_DIR, filename);
}

export { VALID_FILTERS };
