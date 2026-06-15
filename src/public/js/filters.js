/* Filtres photo appliqués côté client via Canvas 2D / ImageData.
   API : Filters.apply(canvas, filterName) — modifie le canvas en place.
   Calibrage volontairement doux ; le même code sert au viseur (live) et à la capture. */
(function () {
  'use strict';

  function clamp(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  // Bruit type "grain argentique", distribution triangulaire (léger, rapide,
  // sans trigonométrie pour rester fluide en aperçu temps réel).
  function noise(intensity) {
    return (Math.random() + Math.random() - 1) * intensity;
  }

  function luminance(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function drawVignette(ctx, w, h, opacity) {
    var g = ctx.createRadialGradient(
      w / 2, h / 2, Math.min(w, h) * 0.35,
      w / 2, h / 2, Math.max(w, h) * 0.75
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,' + opacity + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function drawCenterGlow(ctx, w, h, opacity) {
    var g = ctx.createRadialGradient(
      w / 2, h / 2, 0,
      w / 2, h / 2, Math.max(w, h) * 0.6
    );
    g.addColorStop(0, 'rgba(255,255,255,' + opacity + ')');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function contrastFactor(c) {
    return (259 * (c + 255)) / (255 * (259 - c));
  }

  var FILTERS = {
    raw: function () {},

    // Grain très discret + désaturation minime + vignette à peine perceptible.
    grain: function (ctx, w, h) {
      var img = ctx.getImageData(0, 0, w, h);
      var d = img.data;
      var desat = 0.04;
      for (var i = 0; i < d.length; i += 4) {
        var r = d[i], g = d[i + 1], b = d[i + 2];
        var lum = luminance(r, g, b);
        r = lum + (r - lum) * (1 - desat);
        g = lum + (g - lum) * (1 - desat);
        b = lum + (b - lum) * (1 - desat);
        var n = noise(4);
        d[i] = clamp(r + n);
        d[i + 1] = clamp(g + n);
        d[i + 2] = clamp(b + n);
      }
      ctx.putImageData(img, 0, 0);
      drawVignette(ctx, w, h, 0.1);
    },

    // Délavé doux : désaturation modérée, noirs un peu remontés, chaleur légère.
    fade: function (ctx, w, h) {
      var img = ctx.getImageData(0, 0, w, h);
      var d = img.data;
      var desat = 0.25;
      var liftTo = 14;
      var liftScale = (255 - liftTo) / 255;
      for (var i = 0; i < d.length; i += 4) {
        var r = d[i], g = d[i + 1], b = d[i + 2];
        var lum = luminance(r, g, b);
        r = lum + (r - lum) * (1 - desat);
        g = lum + (g - lum) * (1 - desat);
        b = lum + (b - lum) * (1 - desat);
        r = liftTo + r * liftScale;
        g = liftTo + g * liftScale;
        b = liftTo + b * liftScale;
        var mid = 1 - Math.abs(lum - 128) / 128;
        r += 5 * mid;
        b -= 3 * mid;
        d[i] = clamp(r);
        d[i + 1] = clamp(g);
        d[i + 2] = clamp(b);
      }
      ctx.putImageData(img, 0, 0);
      drawVignette(ctx, w, h, 0.12);
    },

    // Noir & blanc pur : juste la conversion en niveaux de gris, sans grain.
    noir: function (ctx, w, h) {
      var img = ctx.getImageData(0, 0, w, h);
      var d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        var v = clamp(luminance(d[i], d[i + 1], d[i + 2]));
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(img, 0, 0);
    },

    // Polaroid doux : légère saturation et chaleur, halo central discret.
    instant: function (ctx, w, h) {
      var img = ctx.getImageData(0, 0, w, h);
      var d = img.data;
      var sat = 0.12;
      for (var i = 0; i < d.length; i += 4) {
        var r = d[i], g = d[i + 1], b = d[i + 2];
        var lum = luminance(r, g, b);
        r = lum + (r - lum) * (1 + sat);
        g = lum + (g - lum) * (1 + sat);
        b = lum + (b - lum) * (1 + sat);
        r += 8; g += 3; b -= 6;
        d[i] = clamp(r);
        d[i + 1] = clamp(g);
        d[i + 2] = clamp(b);
      }
      ctx.putImageData(img, 0, 0);
      drawCenterGlow(ctx, w, h, 0.05);
    },
  };

  window.Filters = {
    apply: function (canvas, name) {
      var ctx = canvas.getContext('2d');
      var fn = FILTERS[name] || FILTERS.raw;
      fn(ctx, canvas.width, canvas.height);
    },
    has: function (name) {
      return Object.prototype.hasOwnProperty.call(FILTERS, name);
    },
  };
})();
