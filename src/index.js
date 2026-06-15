import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initConfig, getPublicConfig, isRevealed, getConfig } from './lib/config.js';

import camera from './routes/camera.js';
import upload from './routes/upload.js';
import gallery from './routes/gallery.js';
import slideshow from './routes/slideshow.js';
import admin from './routes/admin.js';

await initConfig();

const app = new Hono();

// --- Fichiers statiques (CSS / JS client / icônes) ---
app.use('/css/*', serveStatic({ root: './src/public' }));
app.use('/js/*', serveStatic({ root: './src/public' }));
app.use('/icons/*', serveStatic({ root: './src/public' }));
app.get('/favicon.ico', (c) => c.redirect('/icons/icon-192.png'));

// --- PWA ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Manifest templaté avec le nom de l'événement.
app.get('/manifest.webmanifest', (c) => {
  const cfg = getPublicConfig();
  const manifest = {
    name: cfg.eventName + ' — Photos',
    short_name: 'Photos',
    description: 'Obscura — appareil photo jetable du mariage',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0A0A0A',
    theme_color: '#0A0A0A',
    lang: 'fr',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
  c.header('Content-Type', 'application/manifest+json; charset=utf-8');
  return c.body(JSON.stringify(manifest));
});

// Service worker servi à la racine (scope '/').
let swCache = null;
app.get('/sw.js', async (c) => {
  if (swCache == null || process.env.NODE_ENV !== 'production') {
    swCache = await fs.readFile(path.join(__dirname, 'public', 'sw.js'), 'utf8');
  }
  c.header('Content-Type', 'application/javascript; charset=utf-8');
  c.header('Service-Worker-Allowed', '/');
  c.header('Cache-Control', 'no-cache');
  return c.body(swCache);
});

// --- CORS sur l'upload (configurable) ---
app.use('/upload', (c, next) => {
  const origins = getConfig().allowedOrigins || '*';
  return cors({ origin: origins === '*' ? '*' : origins.split(',').map((o) => o.trim()) })(
    c,
    next
  );
});

// --- API publiques ---
// Statut de la galerie : sondé toutes les 30s par la page galerie.
app.get('/api/status', (c) => {
  const cfg = getPublicConfig();
  return c.json({ locked: !isRevealed(), revealAt: cfg.revealAt, eventName: cfg.eventName });
});

// Config publique (sous-ensemble sûr) pour le client.
app.get('/api/config', (c) => c.json(getPublicConfig()));

// --- Routes applicatives ---
app.route('/', upload);
app.route('/', gallery);
app.route('/', slideshow);
app.route('/', admin);
app.route('/', camera); // GET / en dernier

const port = Number(process.env.PORT) || 3000;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[obscura] en écoute sur http://localhost:${info.port}`);
});
