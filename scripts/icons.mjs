// Renders every icon the page and the manifests need from public/icon.png (the master, transparent):
//
//   public/icons/icon-192.png, icon-512.png   manifest "any" icons and the tab favicon — transparent
//   public/icons/maskable-512.png             manifest "maskable" icon: wood background, the hat kept
//                                             inside the safe zone (a circle 80% of the icon wide)
//   public/icons/apple-touch-icon.png         180 px, opaque on wood (iOS paints transparency black)
//   public/icons/favicon-32.png, favicon-16   tab icons at the sizes browsers actually draw
//   public/favicon.ico                        the 16 and 32 px PNGs in an ICO wrapper for /favicon.ico
//
// Runs before `next dev`/`next build` and skips the work when nothing it depends on has changed.
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {cropToContent, decodePng, encodePng, place} from './png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICON = join(root, 'public', 'icon.png');
const OUT = join(root, 'public', 'icons');
const BACKGROUND = [0xc9, 0x88, 0x4a];

/** `fill`: the hat's width as a fraction of the icon; `opaque`: composited on the wood colour. */
const ICONS = [
  {file: 'icon-512.png', size: 512, fill: 0.9},
  {file: 'icon-192.png', size: 192, fill: 0.9},
  {file: 'maskable-512.png', size: 512, fill: 0.6, opaque: true},
  {file: 'apple-touch-icon.png', size: 180, fill: 0.74, opaque: true},
  {file: 'favicon-32.png', size: 32, fill: 0.96},
  {file: 'favicon-16.png', size: 16, fill: 0.96},
];

/** PNG images wrapped as an .ico (every browser reads PNG-compressed ICO entries). */
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length + 16 * entries.length;
  const directory = entries.map(({size, png}) => {
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size;
    entry[1] = size === 256 ? 0 : size;
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...directory, ...entries.map(e => e.png)]);
}

mkdirSync(OUT, {recursive: true});
const stamp = createHash('sha1')
  .update(readFileSync(ICON))
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .update(readFileSync(join(root, 'scripts', 'png.mjs')))
  .digest('hex');
const stampFile = join(OUT, '.stamp');
let current = '';
try {
  current = readFileSync(stampFile, 'utf8');
} catch {
  // first run
}
if (current === stamp) {
  console.log(`icons: up to date (${OUT})`);
  process.exit(0);
}

const master = cropToContent(decodePng(ICON));
const rendered = new Map();
for (const {file, size, fill, opaque} of ICONS) {
  const fitW = Math.round(size * fill);
  const fitH = Math.round((fitW * master.height) / master.width);
  const png = encodePng(place(master, size, size, fitW, fitH, opaque ? BACKGROUND : null), {alpha: !opaque});
  writeFileSync(join(OUT, file), png);
  rendered.set(file, png);
}
writeFileSync(
  join(root, 'public', 'favicon.ico'),
  encodeIco([
    {size: 16, png: rendered.get('favicon-16.png')},
    {size: 32, png: rendered.get('favicon-32.png')},
  ]),
);
writeFileSync(stampFile, stamp);
console.log(`icons: ${ICONS.length} icons + favicon.ico rendered (${OUT})`);
