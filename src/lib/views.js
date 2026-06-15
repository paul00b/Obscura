import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.resolve(__dirname, '..', '..', 'views');

const cache = new Map();
const isDev = process.env.NODE_ENV !== 'production';

async function loadView(name) {
  if (!isDev && cache.has(name)) return cache.get(name);
  const html = await fs.readFile(path.join(VIEWS_DIR, `${name}.html`), 'utf8');
  cache.set(name, html);
  return html;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Remplace {{key}} (échappé) et {{{key}}} (brut) dans le template.
export async function renderView(name, vars = {}) {
  let html = await loadView(name);
  html = html.replace(/\{\{\{\s*(\w+)\s*\}\}\}/g, (_, key) =>
    key in vars ? String(vars[key] ?? '') : ''
  );
  html = html.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) =>
    key in vars ? escapeHtml(vars[key] ?? '') : ''
  );
  return html;
}
