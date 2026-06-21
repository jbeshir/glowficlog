// Generates simple placeholder extension icons (solid rounded squares with a
// "G" notch) at 16/48/128 px. Pure Node (zlib) — no native deps, no network.
// Re-run with `node scripts/gen-icons.mjs` if you want to regenerate them.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'icons');
mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(size) {
  // RGBA raw image: a brand-blue rounded square with a lighter "G"-ish glyph.
  const bg = [37, 99, 235, 255]; // brand blue
  const fg = [219, 234, 254, 255]; // light glyph
  const r = Math.floor(size * 0.18); // corner radius
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter byte: none
    for (let x = 0; x < size; x++) {
      // rounded-corner mask
      const inCorner =
        (x < r && y < r && (r - x) ** 2 + (r - y) ** 2 > r * r) ||
        (x >= size - r && y < r && (x - (size - r)) ** 2 + (r - y) ** 2 > r * r) ||
        (x < r && y >= size - r && (r - x) ** 2 + (y - (size - r)) ** 2 > r * r) ||
        (x >= size - r && y >= size - r && (x - (size - r)) ** 2 + (y - (size - r)) ** 2 > r * r);
      // crude centred "G": a ring with a gap + inner bar on the right half
      const cx = size / 2;
      const cy = size / 2;
      const dist = Math.hypot(x - cx, y - cy);
      const ringOuter = size * 0.34;
      const ringInner = size * 0.2;
      const onRing = dist < ringOuter && dist > ringInner;
      const gap = x > cx && y < cy && dist > ringInner; // open top-right
      const innerBar = x > cx && Math.abs(y - cy) < size * 0.06 && dist < ringOuter;
      const isGlyph = (onRing && !gap) || innerBar;
      let col = inCorner ? [0, 0, 0, 0] : isGlyph ? fg : bg;
      raw[p++] = col[0];
      raw[p++] = col[1];
      raw[p++] = col[2];
      raw[p++] = col[3];
    }
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const idat = deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 48, 128]) {
  const file = resolve(outDir, `icon-${size}.png`);
  writeFileSync(file, makePng(size));
  console.log('wrote', file);
}
