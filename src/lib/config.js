import { promises as fs } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const DATA_PATH = process.env.DATA_PATH || path.resolve('data');
const CONFIG_FILE = path.join(DATA_PATH, 'config.json');
export const DATA_DIR = DATA_PATH;

// Config GLOBALE (à l'échelle du serveur, pas d'un événement).
// Les réglages propres à chaque galerie vivent dans events/<slug>/event.json.
const DEFAULT_CONFIG = {
  adminPasswordHash: '',
  allowedOrigins: '*',
  maxPhotoSizeMb: 8,
};

const EDITABLE_FIELDS = ['allowedOrigins', 'maxPhotoSizeMb'];

let cache = null;

async function ensureDirs() {
  await fs.mkdir(DATA_PATH, { recursive: true });
}

export async function initConfig() {
  await ensureDirs();
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    // On ne garde que les champs globaux connus (les anciens champs
    // d'événement éventuellement présents sont ignorés ici — la migration
    // s'en sert pour créer le premier événement).
    const parsed = JSON.parse(raw);
    cache = { ...DEFAULT_CONFIG };
    for (const key of [...EDITABLE_FIELDS, 'adminPasswordHash']) {
      if (key in parsed) cache[key] = parsed[key];
    }
  } catch {
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

export async function updateConfig(patch) {
  const cfg = getConfig();
  for (const key of EDITABLE_FIELDS) {
    if (!(key in patch)) continue;
    let value = patch[key];
    if (key === 'maxPhotoSizeMb') {
      if (value === '' || value === null || value === undefined) {
        value = cfg[key];
      } else {
        value = Number(value);
        if (Number.isNaN(value)) continue;
      }
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

// Lecture brute de l'ancien config.json (pour la migration mono-événement).
export async function readLegacyConfig() {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
