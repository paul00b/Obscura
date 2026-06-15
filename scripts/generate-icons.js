// Génère les icônes PWA (PNG) sans dépendance externe.
// Dessine une "lentille" minimaliste : fond sombre + anneau et point beige.
// Usage : node scripts/generate-icons.js
import zlib from 'node:zlib';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'src', 'public', 'icons');

const BG = [0x0a, 0x0a, 0x0a];
const ACCENT = [0xc8, 0xb8, 0x9a];

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// Couverture "accent" d'un pixel via supersampling 3x3 (anti-aliasing).
function accentCoverage(px, py, N) {
  const cx = N / 2;
  const cy = N / 2;
  const rDot = N * 0.1;
  const rInner = N * 0.2;
  const rOuter = N * 0.3;
  let hits = 0;
  const samples = 3;
  for (let sx = 0; sx < samples; sx++) {
    for (let sy = 0; sy < samples; sy++) {
      const x = px + (sx + 0.5) / samples;
      const y = py + (sy + 0.5) / samples;
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (d <= rDot || (d >= rInner && d <= rOuter)) hits++;
    }
  }
  return hits / (samples * samples);
}

function buildRGBA(N) {
  const raw = Buffer.alloc(N * (N * 4 + 1)); // +1 byte filtre par ligne
  let o = 0;
  for (let y = 0; y < N; y++) {
    raw[o++] = 0; // filtre "none"
    for (let x = 0; x < N; x++) {
      const cov = accentCoverage(x, y, N);
      const c = mix(BG, ACCENT, cov);
      raw[o++] = c[0];
      raw[o++] = c[1];
      raw[o++] = c[2];
      raw[o++] = 255;
    }
  }
  return raw;
}

// CRC32 (table)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(N) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0);
  ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(buildRGBA(N), { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  for (const N of [192, 512, 180]) {
    const png = encodePNG(N);
    const name = N === 180 ? 'apple-touch-icon.png' : `icon-${N}.png`;
    await fs.writeFile(path.join(OUT_DIR, name), png);
    console.log(`icône générée : ${name} (${png.length} octets)`);
  }
}
main();
