// Renders the iOS launch images ("apple-touch-startup-image") into public/splash: iOS shows no
// launch screen for a home-screen web app unless the page links a PNG whose pixel size matches the
// device exactly (it does not derive one from the manifest, and data: URLs stopped working in
// iOS 17.6), so one file per size in scripts/splash-devices.json and orientation is rendered here:
// the page's wood colour with the app icon in the middle, which is what the page then paints.
//
// Runs before `next dev`/`next build` and skips the work when nothing it depends on has changed.
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {cropToContent, decodePng, encodePng, place} from './png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICON = join(root, 'public', 'icon.png');
const OUT = join(root, 'public', 'splash');
const DEVICES = JSON.parse(readFileSync(join(root, 'scripts', 'splash-devices.json'), 'utf8'));
/** Page background (`bg-[#c9884a]` on <body>), so the launch image and the first paint are one colour. */
const BACKGROUND = [0xc9, 0x88, 0x4a];
/** The icon's width as a fraction of the shorter screen edge… */
const ICON_SHARE = 0.42;
/** …but never enlarged beyond this factor of its source, which would show as blur on iPads. */
const MAX_UPSCALE = 1.5;

mkdirSync(OUT, {recursive: true});
// Outputs are keyed on the inputs: a changed icon, device table, colour or renderer regenerates them.
const stamp = createHash('sha1')
  .update(readFileSync(ICON))
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .update(readFileSync(join(root, 'scripts', 'png.mjs')))
  .update(JSON.stringify(DEVICES))
  .digest('hex');
const stampFile = join(OUT, '.stamp');
let current = '';
try {
  current = readFileSync(stampFile, 'utf8');
} catch {
  // first run
}
if (current === stamp) {
  console.log(`splash: up to date (${OUT})`);
  process.exit(0);
}

const sizes = new Map();
for (const {width, height, scale} of DEVICES) {
  sizes.set(`${width * scale}x${height * scale}`, [width * scale, height * scale]);
  sizes.set(`${height * scale}x${width * scale}`, [height * scale, width * scale]);
}

const icon = cropToContent(decodePng(ICON));
for (const [name, [width, height]] of sizes) {
  const fitW = Math.min(Math.round(Math.min(width, height) * ICON_SHARE), Math.round(icon.width * MAX_UPSCALE));
  const fitH = Math.round((fitW * icon.height) / icon.width);
  writeFileSync(join(OUT, `${name}.png`), encodePng(place(icon, width, height, fitW, fitH, BACKGROUND), {alpha: false}));
}
writeFileSync(stampFile, stamp);
console.log(`splash: ${sizes.size} launch images rendered (${OUT})`);
