// Writes public/sw.js from scripts/sw.template.js after `next build`: the build id names the cache
// and the precache list is read off the build output, so it always matches what is deployed.
//
// Precached: the page, the manifest and icon, every script chunk except the nomodule polyfills (a
// browser with service workers never loads them), the stylesheets, the build manifests, the sprites,
// the voice clips, and only the font slices that render the UI's glyphs — RocknRoll One is a Japanese
// font cut into ~120 unicode-range slices, and the game needs three of them.
//
// `--dev` (run before `next dev`) writes a worker that unregisters itself instead: a production
// worker left on the origin by `next start` would otherwise keep serving that build's shell whenever
// the dev server is slower than the navigation timeout (a cold compile always is), and that shell's
// scripts cannot know they are on a dev server. The browser's update check swaps it for this one,
// which drops the registration and reloads its pages so they get the dev server's HTML.
import {readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NEXT = join(root, '.next');
const STATIC = join(NEXT, 'static');
const TEMPLATE = join(root, 'scripts', 'sw.template.js');
const OUT = join(root, 'public', 'sw.js');

/** Code points the UI renders: printable ASCII and Latin-1, general punctuation (· — …), ← ↑ → ↓. */
const GLYPHS = [
  [0x20, 0x7e],
  [0xa0, 0xff],
  [0x2000, 0x206f],
  [0x2190, 0x2193],
];

if (process.argv.includes('--dev')) {
  writeFileSync(
    OUT,
    `// Development stand-in written by scripts/sw.mjs --dev: removes any Mamboka worker on this origin.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      await self.registration.unregister();
      for (const key of await caches.keys()) if (key.startsWith('mamboka-')) await caches.delete(key);
      for (const client of await self.clients.matchAll({type: 'window'})) client.navigate(client.url);
    })(),
  );
});
`,
  );
  console.log(`sw: development worker (unregisters itself) → ${relative(root, OUT)}`);
  process.exit(0);
}

let buildId;
try {
  buildId = readFileSync(join(NEXT, 'BUILD_ID'), 'utf8').trim();
} catch {
  console.error('sw: no .next/BUILD_ID — run `next build` first');
  process.exit(1);
}

/** Files under `dir`, as paths relative to it, sorted for a stable output. */
function walk(dir, base = dir) {
  const out = [];
  try {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(path, base));
      else out.push(relative(base, path));
    }
  } catch {
    // Absent directory (e.g. no audio): nothing to add.
  }
  return out.sort();
}

const toUrl = (section, file) => `/_next/static/${section}/${file.split('\\').join('/')}`;

/**
 * The font files that render `GLYPHS`: for each code point the last @font-face rule in source order
 * whose unicode-range covers it wins, as in the browser.
 */
function fontSlices(cssFiles) {
  const faces = [];
  for (const file of cssFiles) {
    const css = readFileSync(join(STATIC, 'css', file), 'utf8');
    for (const [, block] of css.matchAll(/@font-face\{([^}]*)\}/g)) {
      const url = /url\(([^)]+)\)/.exec(block)?.[1];
      const ranges = /unicode-range:([^;]+)/.exec(block)?.[1];
      if (!url || !ranges) continue;
      faces.push({
        url,
        ranges: ranges.split(',').map(range => {
          const m = /u\+([0-9a-f?]+)(?:-([0-9a-f]+))?/i.exec(range.trim());
          const lo = parseInt(m[1].replace(/\?/g, '0'), 16);
          const hi = m[2] ? parseInt(m[2], 16) : parseInt(m[1].replace(/\?/g, 'f'), 16);
          return [lo, hi];
        }),
      });
    }
  }
  const urls = new Set();
  for (const [from, to] of GLYPHS) {
    for (let cp = from; cp <= to; cp++) {
      const face = faces.findLast(f => f.ranges.some(([lo, hi]) => cp >= lo && cp <= hi));
      if (face) urls.add(face.url);
    }
  }
  return [...urls].sort();
}

const chunks = walk(join(STATIC, 'chunks')).filter(file => !/^polyfills-/.test(basename(file)));
const css = walk(join(STATIC, 'css'));
const media = walk(join(STATIC, 'media')).filter(file => !file.endsWith('.woff2'));

const precache = [
  '/',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/icons/favicon-32.png',
  '/icons/icon-192.png',
  ...chunks.map(file => toUrl('chunks', file)),
  ...css.map(file => toUrl('css', file)),
  ...walk(join(STATIC, buildId)).map(file => toUrl(buildId, file)),
  ...media.map(file => toUrl('media', file)),
  ...fontSlices(css),
  ...walk(join(STATIC, 'audio')).map(file => toUrl('audio', file)),
];

const template = readFileSync(TEMPLATE, 'utf8');
if (!template.includes("'__VERSION__'") || !template.includes('__PRECACHE__')) {
  console.error('sw: template placeholders missing');
  process.exit(1);
}
writeFileSync(
  OUT,
  template.replace("'__VERSION__'", JSON.stringify(buildId)).replace('__PRECACHE__', JSON.stringify(precache, null, 2)),
);

let bytes = 0;
for (const url of precache) {
  if (!url.startsWith('/_next/static/')) continue;
  bytes += statSync(join(STATIC, url.slice('/_next/static/'.length))).size;
}
console.log(`sw: ${precache.length} files precached (${(bytes / 1024).toFixed(0)} KB of static assets), build ${buildId} → ${relative(root, OUT)}`);
