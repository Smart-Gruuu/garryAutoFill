/* Generates icons/icon{16,32,48,128}.png (teal rounded square + white bolt) without external dependencies. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.resolve(__dirname, '..', 'icons');
const BG = [15, 118, 110];
const FG = [255, 255, 255];
// bolt polygon in a 24x24 design grid
const BOLT = [[13, 2], [4.5, 13.5], [11, 13.5], [10, 22], [18.5, 10.5], [12, 10.5]];

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRoundRect(x, y, size, r) {
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function crc32(buf) {
  let c; const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, n) => {
    c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
  }));
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const SS = 4;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const radius = size * 0.22;
  const scale = size / 24;
  const pad = size * 0.08;
  const boltScale = (size - pad * 2) / 24;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let bgCov = 0; let fgCov = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS; const py = y + (sy + 0.5) / SS;
          if (inRoundRect(px, py, size, radius)) {
            bgCov++;
            if (inPoly((px - pad) / boltScale, (py - pad) / boltScale, BOLT)) fgCov++;
          }
        }
      }
      const n = SS * SS;
      const a = bgCov / n; const f = bgCov ? fgCov / bgCov : 0;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(BG[k] * (1 - f) + FG[k] * f);
      raw[o + 3] = Math.round(a * 255);
    }
  }
  void scale;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const s of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(OUT, `icon${s}.png`), png(s));
  console.log('wrote icons/icon' + s + '.png');
}
