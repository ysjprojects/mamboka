# Mamboka

A Suika Game parody. Eleven chibi characters drop into a glass box; two of a kind touching evolve into the next one — Mejiro McQueen → Vodka → Daiwa Scarlet → Tokai Teio → Chiyono O → Silence Suzuka → Kitasan Black → Gold Ship → Haru Urara → Special Week → Mambo — and two Mambos cancel out.

Rules follow the Switch version of Suika Game: only the five smallest fall from Poppy the cloud (uniform, one-ahead preview), points per evolution are the triangular numbers 1…55 (66 for a Mambo pair), fruit-size ratios and the 0.46 watermelon-to-box ratio come from pixel measurements of the Switch build, all characters weigh the same, the evolved character appears at rest at the parents' midpoint, and a character that settles above the rim for a second ends the game.

Phones get a one-row HUD across the top (drag to aim, release to drop); desktops get the Switch layout (score and leaderboard on the left, Next and the Circle of Evolution on the right; `←`/`→` aim, `Space` drops, `P` pauses, `R` restarts). Everything is client-side: there is no server and nothing leaves the device.

## Running it

```sh
yarn install   # yarn classic; .yarnrc ignores eslint-visitor-keys' node>=22.13 engine
yarn dev       # Next.js on :3000
yarn build && yarn start
```

Other scripts: `yarn compile` (tsc), `yarn lint` (prettier + eslint).

Environment (see `.env.example`): `NEXT_PUBLIC_SITE_URL` — public origin, used for the canonical link and Open Graph URL. Optional.

## Deploying

A static Next.js 14 (pages router) app with no API routes; Vercel works out of the box. The web manifest and `apple-mobile-web-app-capable` let the game be added to a phone's home screen and run full-screen.

## How it works

- `src/game/contour.ts` traces each sprite's alpha channel (largest blob → Moore boundary → Douglas–Peucker → small-pocket pruning) so the physics body is the character's real silhouette, decomposed into convex parts by `poly-decomp` through Matter.js `Bodies.fromVertices`; `shapes.ts` runs it at load time, so replacing a PNG in `src/images/` needs no other change.
- `engine.ts` is the Matter.js world and rules (fixed 60 Hz steps, merge queue, drop lock released on first contact, rim timer); `renderer.ts` draws the scene on a canvas fitted around the DOM HUD (`src/components/MambokaGame.tsx`, `hud.tsx`); `roster.ts` is the cast (names, sprites, voice clips, size ratios, accent colours).
- `audio.ts` synthesises the drop/pop/game-over sounds with WebAudio and plays a tier's voice clip (`voice` in `roster.ts`: `tokai_teio`, `chiyono`, `kitasan_black`, `gold_ship`, `haru_urara`, `special_week`, `mambo` `.mp3`) whenever a merge creates that tier — only one voice at a time: a new voice cuts the playing one, and mute/restart cut it too. Audio is unlocked only inside activation-triggering events (`pointerup`, mouse `pointerdown`, `click`, `keydown` — a touch `pointerdown` grants no activation), the context is resumed from iOS's `interrupted` state, and on iOS a looping silent `silence.mp3` keeps the page in the "playback" audio session so the game stays audible with the ringer switch on silent. The best score lives in `localStorage`. In development the engine is exposed as `window.__mamboka`; `D` toggles the silhouette overlay.
- **Character groups** (`game/groups.ts`, `components/Groups.tsx`): the Characters button lists the original cast plus any group the player made by uploading eleven images with a title: the editor lays the slots out as a ring like the Circle of Evolution (#1 at the top, clockwise to #11, arrows between them); tap a slot to pick its image or "Pick 11 at once" (sorted by file name), and drag a slot onto another position to reorder (pointer events, so mouse and touch both work). Uploads are decoded through an `<img>`, downscaled to 512 px, re-encoded as PNG (alpha kept, so silhouette physics still applies) and stored in IndexedDB (`mamboka` db: `groups` = metadata + 48 px thumbnails, `images` = PNG bytes as ArrayBuffers keyed by `[groupId, slot]` — not Blobs, which iOS Safari intermittently refuses to store); the chosen group id lives in `localStorage` and is reloaded on the next visit. Switching or saving a group starts a new run. Only the original cast has voice lines; custom groups keep the synthesised pops and jingles, and their merge bursts use each sprite's mean colour.
- **Leaderboard** (`game/leaderboard.ts`, `components/Leaderboard.tsx`): every finished run is recorded with the player's name (asked for on the game-over card, remembered for next time, editable live), the score and the group it was played with; the top 50 stay in `localStorage` (the earlier unnamed `mamboka.ranking` rows are migrated as "Anonymous"). It is per device — there is no server.
- The in-game font is RocknRoll One (the OFL cut of Fontworks RocknRoll, which Suika Game uses), loaded through `next/font/google` in `src/pages/index.tsx` and handed to the canvas renderer as a CSS font-family.
