import { promises as fs } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const DATA_PATH = process.env.DATA_PATH || path.resolve('data');
const CONFIG_FILE = path.join(DATA_PATH, 'config.json');
export const PHOTOS_DIR = path.join(DATA_PATH, 'photos');
export const SESSIONS_DIR = path.join(DATA_PATH, 'sessions');

const DEFAULT_CONFIG = {
  eventName: 'Paul & Jordane',
  eventDate: '2026-07-11',
  revealAt: '2026-07-12T09:00:00',
  maxPhotosPerSession: null,
  filterDefault: 'raw',
  galleryLocked: true,
  adminPasswordHash: '',
  slideshowInterval: 4000,
  slideshowOrder: 'random', // 'random' | 'chronological'
  welcomeMessage: 'Prends une photo, elle rejoindra la galerie demain matin.',
  allowedOrigins: '*',
  maxPhotoSizeMb: 8,
};

// Champs autorisés à être modifiés depuis le dashboard admin.
const EDITABLE_FIELDS = [
  'eventName',
  'eventDate',
  'revealAt',
  'maxPhotosPerSession',
  'filterDefault',
  'galleryLocked',
  'slideshowInterval',
  'slideshowOrder',
  'welcomeMessage',
  'allowedOrigins',
  'maxPhotoSizeMb',
];

// Champs exposables publiquement (jamais le hash du mot de passe).
const PUBLIC_FIELDS = [
  'eventName',
  'eventDate',
  'revealAt',
  'maxPhotosPerSession',
  'filterDefault',
  'galleryLocked',
  'slideshowInterval',
  'slideshowOrder',
  'welcomeMessage',
];

let cache = null;

async function ensureDirs() {
  await fs.mkdir(DATA_PATH, { recursive: true });
  await fs.mkdir(PHOTOS_DIR, { recursive: true });
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

export async function initConfig() {
  await ensureDirs();
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    cache = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    // Premier démarrage : on crée config.json depuis les valeurs par défaut.
    cache = { ...DEFAULT_CONFIG };
    const seedPassword = process.env.ADMIN_PASSWORD || 'changeme';
    cache.adminPasswordHash = bcrypt.hashSync(seedPassword, 10);
    await persist();
    console.log(
      `[config] config.json créé. Mot de passe admin initial : "${seedPassword}" — change-le depuis le dashboard.`
    );
  }
  return cache;
}

async function persist() {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

export function getConfig() {
  if (!cache) throw new Error('Config non initialisée. Appelle initConfig() au démarrage.');
  return cache;
}

export function getPublicConfig() {
  const cfg = getConfig();
  const out = {};
  for (const key of PUBLIC_FIELDS) out[key] = cfg[key];
  return out;
}

export async function updateConfig(patch) {
  const cfg = getConfig();
  for (const key of EDITABLE_FIELDS) {
    if (!(key in patch)) continue;
    let value = patch[key];

    if (key === 'maxPhotosPerSession' || key === 'slideshowInterval' || key === 'maxPhotoSizeMb') {
      if (value === '' || value === null || value === undefined) {
        value = key === 'maxPhotosPerSession' ? null : cfg[key];
      } else {
        value = Number(value);
        if (Number.isNaN(value)) continue;
      }
    }
    if (key === 'galleryLocked') {
      value = value === true || value === 'true' || value === 'on' || value === '1';
    }
    cfg[key] = value;
  }
  await persist();
  return cfg;
}

export async function setAdminPassword(plainPassword) {
  const cfg = getConfig();
  cfg.adminPasswordHash = bcrypt.hashSync(plainPassword, 10);
  await persist();
}

export function verifyAdminPassword(plainPassword) {
  const cfg = getConfig();
  if (!cfg.adminPasswordHash) return false;
  return bcrypt.compareSync(plainPassword, cfg.adminPasswordHash);
}

// La galerie est-elle révélée pour le public ?
export function isRevealed() {
  const cfg = getConfig();
  if (cfg.galleryLocked === false) return true;
  if (!cfg.revealAt) return false;
  const revealTime = new Date(cfg.revealAt).getTime();
  if (Number.isNaN(revealTime)) return false;
  return Date.now() >= revealTime;
}
