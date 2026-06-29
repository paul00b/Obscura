import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initConfig } from './lib/config.js';
import { migrateLegacyEvent } from './lib/events.js';

import event from './routes/event.js';
import admin from './routes/admin.js';

await initConfig();
await migrateLegacyEvent();

const app = new Hono();

// --- Fichiers statiques (CSS / JS client / icônes) ---
app.use('/css/*', serveStatic({ root: './src/public' }));
app.use('/js/*', serveStatic({ root: './src/public' }));
app.use('/icons/*', serveStatic({ root: './src/public' }));
app.get('/favicon.ico', (c) => c.redirect('/icons/icon-192.png'));

// --- PWA : service worker servi à la racine (scope '/') ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

// --- Routes applicatives ---
app.route('/', admin);          // /admin/*
app.route('/e', event);         // /e/:slug/* (galeries invité)

// Racine : pas de galerie par défaut → on envoie vers l'admin.
app.get('/', (c) => c.redirect('/admin'));

const port = Number(process.env.PORT) || 3000;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[obscura] en écoute sur http://localhost:${info.port}`);
});
