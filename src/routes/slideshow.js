import { Hono } from 'hono';
import { getPublicConfig, isRevealed } from '../lib/config.js';
import { renderView } from '../lib/views.js';
import { isAdmin } from '../lib/auth.js';

const slideshow = new Hono();

// GET /slideshow → diaporama plein écran (post-reveal)
slideshow.get('/slideshow', async (c) => {
  const cfg = getPublicConfig();
  // Avant reveal, le diaporama est réservé à l'admin (preview).
  if (!isRevealed() && !isAdmin(c)) {
    const html = await renderView('gallery', {
      eventName: cfg.eventName,
      revealAt: cfg.revealAt,
      preview: 'false',
    });
    return c.html(html);
  }
  const html = await renderView('slideshow', {
    eventName: cfg.eventName,
    slideshowInterval: cfg.slideshowInterval,
    slideshowOrder: cfg.slideshowOrder,
  });
  return c.html(html);
});

export default slideshow;
