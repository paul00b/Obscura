import { Hono } from 'hono';
import { getPublicConfig } from '../lib/config.js';
import { renderView } from '../lib/views.js';

const camera = new Hono();

// GET / → page caméra invité
camera.get('/', async (c) => {
  const cfg = getPublicConfig();
  const html = await renderView('camera', {
    eventName: cfg.eventName,
    welcomeMessage: cfg.welcomeMessage,
    filterDefault: cfg.filterDefault,
    maxPhotosPerSession: cfg.maxPhotosPerSession ?? '',
    revealAt: cfg.revealAt ?? '',
  });
  return c.html(html);
});

export default camera;
