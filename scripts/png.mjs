// Dependency-free PNG helpers for the asset scripts (launch images, icons): decode 8-bit RGB/RGBA,
// encode RGB/RGBA, resample, crop to the opaque area and place onto a canvas. Images are
// `{width, height, pixels}` with `pixels` a Buffer of 8-bit RGBA rows.
import {readFileSync} from 'node:fs';
import {deflateSync, inflateSync} from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* ---------------------------------------------------------------- decode */

export function decodePng(file) {
  const data = readFileSync(file);
  if (!data.subarray(0, 8).equals(SIGNATURE)) throw new Error(`${file}: not a PNG`);
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  for (let pos = 8; pos < data.length; ) {
    const length = data.readUInt32BE(pos);
    const type = data.toString('latin1', pos + 4, pos + 8);
    const chunk = data.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      const [depth, colour, interlace] = [chunk[8], chunk[9], chunk[12]];
      channels = colour === 6 ? 4 : colour === 2 ? 3 : 0;
      if (depth !== 8 || !channels || interlace) {
        throw new Error(`${file}: only 8-bit RGB/RGBA non-interlaced PNGs are supported`);
      }
    } else if (type === 'IDAT') idat.push(chunk);
    pos += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = (line[x] + predictor) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const j = x * channels;
      pixels[i] = line[j];
      pixels[i + 1] = line[j + 1];
      pixels[i + 2] = line[j + 2];
      pixels[i + 3] = channels === 4 ? line[j + 3] : 255;
    }
    prev = line;
  }
  return {width, height, pixels};
}

/* ---------------------------------------------------------------- encode */

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/** Encodes RGBA pixels; `alpha: false` writes opaque RGB (smaller, and what iOS wants for icons). */
export function encodePng({width, height, pixels}, {alpha = true} = {}) {
  const channels = alpha ? 4 : 3;
  const stride = width * channels;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    filtered[row] = 2; // "Up": flat areas become runs of zeros, which deflate loves.
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < channels; k++) {
        const here = pixels[(y * width + x) * 4 + k];
        const above = y ? pixels[((y - 1) * width + x) * 4 + k] : 0;
        filtered[row + 1 + x * channels + k] = (here - above) & 0xff;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filtered, {level: 9})),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------------- resample */

/**
 * Per-axis resampling weights: a triangle filter widened to the scale factor, i.e. bilinear when
 * enlarging and an area-weighted tent when shrinking, so small icons keep smooth edges.
 */
function weights(srcLen, dstLen) {
  const scale = srcLen / dstLen;
  const support = Math.max(1, scale);
  const table = [];
  for (let i = 0; i < dstLen; i++) {
    const centre = (i + 0.5) * scale;
    const lo = Math.max(0, Math.floor(centre - support));
    const hi = Math.min(srcLen - 1, Math.ceil(centre + support));
    const taps = [];
    let sum = 0;
    for (let j = lo; j <= hi; j++) {
      const w = 1 - Math.abs(j + 0.5 - centre) / support;
      if (w > 0) {
        taps.push([j, w]);
        sum += w;
      }
    }
    table.push(taps.map(([j, w]) => [j, w / sum]));
  }
  return table;
}

/** Resizes to `w × h`, premultiplying alpha so transparent edges do not darken. */
export function resample(image, w, h) {
  const {width, height, pixels} = image;
  // Premultiplied float RGBA.
  const src = new Float32Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const a = pixels[i * 4 + 3] / 255;
    src[i * 4] = pixels[i * 4] * a;
    src[i * 4 + 1] = pixels[i * 4 + 1] * a;
    src[i * 4 + 2] = pixels[i * 4 + 2] * a;
    src[i * 4 + 3] = a;
  }
  // Horizontal pass → width w, height unchanged.
  const xw = weights(width, w);
  const mid = new Float32Array(w * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (const [sx, wt] of xw[x]) {
        const i = (y * width + sx) * 4;
        mid[o] += src[i] * wt;
        mid[o + 1] += src[i + 1] * wt;
        mid[o + 2] += src[i + 2] * wt;
        mid[o + 3] += src[i + 3] * wt;
      }
    }
  }
  // Vertical pass → height h.
  const yw = weights(height, h);
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const [sy, wt] of yw[y]) {
        const i = (sy * w + x) * 4;
        r += mid[i] * wt;
        g += mid[i + 1] * wt;
        b += mid[i + 2] * wt;
        a += mid[i + 3] * wt;
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        out[o] = Math.round(Math.min(255, r / a));
        out[o + 1] = Math.round(Math.min(255, g / a));
        out[o + 2] = Math.round(Math.min(255, b / a));
        out[o + 3] = Math.round(Math.min(255, a * 255));
      }
    }
  }
  return {width: w, height: h, pixels: out};
}

/* ---------------------------------------------------------------- compose */

/** The image cropped to its non-transparent pixels (alpha above `threshold`). */
export function cropToContent(image, threshold = 8) {
  const {width, height, pixels} = image;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return image;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) pixels.copy(out, y * w * 4, ((y0 + y) * width + x0) * 4, ((y0 + y) * width + x0 + w) * 4);
  return {width: w, height: h, pixels: out};
}

/**
 * A `width × height` canvas, transparent or filled with `background` ([r, g, b]), with `image`
 * scaled to fit a `fitW × fitH` box and composited at the centre.
 */
export function place(image, width, height, fitW, fitH, background = null) {
  const scale = Math.min(fitW / image.width, fitH / image.height);
  const scaled = resample(image, Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  const pixels = Buffer.alloc(width * height * 4);
  if (background) {
    for (let i = 0; i < width * height; i++) {
      pixels[i * 4] = background[0];
      pixels[i * 4 + 1] = background[1];
      pixels[i * 4 + 2] = background[2];
      pixels[i * 4 + 3] = 255;
    }
  }
  const left = Math.floor((width - scaled.width) / 2);
  const top = Math.floor((height - scaled.height) / 2);
  for (let y = 0; y < scaled.height; y++) {
    for (let x = 0; x < scaled.width; x++) {
      const s = (y * scaled.width + x) * 4;
      const a = scaled.pixels[s + 3] / 255;
      if (a === 0) continue;
      const d = ((top + y) * width + left + x) * 4;
      const da = pixels[d + 3] / 255;
      const outA = a + da * (1 - a);
      for (let k = 0; k < 3; k++) {
        pixels[d + k] = Math.round((scaled.pixels[s + k] * a + pixels[d + k] * da * (1 - a)) / outA);
      }
      pixels[d + 3] = Math.round(outA * 255);
    }
  }
  return {width, height, pixels};
}
