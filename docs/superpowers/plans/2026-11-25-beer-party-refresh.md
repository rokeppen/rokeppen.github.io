# Beer Party Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle "Friday Afternoon Drinks" to the approved pastel flat-2D look with a beer theme, add the Café tower and Wine Snob guest, guest quotes/immunities, per-level guest lists, a seeded level generator in the editor, and admin-uploaded images in Supabase Storage.

**Architecture:** Extends the existing codebase on branch `tower-defence`. New rules (immunity, quotes) go into the pure simulation; the generator is a pure shared module; image handling is one game helper plus one admin upload module; Phaser stays the renderer with shapes baked into reusable textures.

**Tech Stack:** Native ES modules (no build step), Phaser 3.90.0 (CDN + vendored fallback), supabase-js 2.57.4 incl. Storage, Node 26 `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-25-beer-party-refresh-design.md` (builds on `docs/superpowers/specs/2026-11-25-friday-drinks-tower-defence-design.md`).

## Global Constraints

- No build step, no npm dependencies. Pure modules (`shared/`, `game/logic/`, `admin/editor-state.js`, `admin/catalog-validate.js`, `admin/upload-validate.js`, `game/sprites-data.js`) must not import CDN URLs or touch the DOM.
- Only the Supabase **publishable** key in code. Anonymous visitors can't write tables or Storage.
- Player-facing names: currency **bottle caps 🧢**, lives **kegs 🍺**, target **beer bar 🍻**. Internal names stay (`corks`/`startingCorks` = caps, `wine`/`startingWine`/`wineDamage` = kegs); add a one-line comment where these are defined in `theme.js` and `shared/model.js`.
- Title stays "Friday Afternoon Drinks". UI language English. Admin DOM via DOM APIs/textContent only.
- Sprites: a sprite string matching `/^https?:\/\//` is an image URL, anything else is an emoji. Every weapon/enemy has `fallbackSprite` (emoji; equals `sprite` when `sprite` is an emoji). Defaults: guests 👤, weapons ❔, bar 🍻.
- Storage bucket `sprites`: public read, admin-only write, ≤ 1 MB, types `image/png`, `image/jpeg`, `image/svg+xml`, `image/webp`.
- Every task ends with `cd tower-defence && npm test` green and a commit (no push). Add a `/REGRET.md` line whenever something that worked breaks.

### Data shapes (additions to the existing shapes)

```js
// Weapon: + fallbackSprite
// Enemy:  + quotes: string[], immuneTo: Array<'slow'|'distract'|'lure'>, fallbackSprite
// Level:  + enemyIds: string[] | null (null/undefined = legacy row: derive from waves), barSprite: string
```
DB: `weapons.fallback_sprite text`, `enemies.quotes jsonb default '[]'`, `enemies.immune_to text[] default '{}'`, `enemies.fallback_sprite text`, `levels.enemy_ids text[]` (nullable, no default), `levels.bar_sprite text default '🍻'`.

## Review Focus

1. **An image URL fails** (404, CORS, Storage down): the game still starts and shows the item's fallback emoji everywhere it appears. (Task 5 tests.)
2. **A pre-migration DB row** (no `enemy_ids`, `quotes`, `immune_to`, `fallback_sprite`, `bar_sprite`): game and editor still load it; guest list is derived from its waves. (Task 1 tests.)
3. **Generator extremes** (one guest, one damage weapon, Small/Large, twistiness 0 and 1, 1 and 20 waves): output always passes `validateLevel` with zero errors and the editor's `canSave`. (Task 4 tests.)
4. **An immune guest is hit by that effect**: no slow/stall and no stall-immunity window starts; damage still lands; other effects unaffected. (Task 3 tests.)
5. **Upload of a wrong type, oversize file, or a Storage error**: inline error, buttons re-enabled, sprite unchanged. (Task 8 tests.)

---

### Task 1: Data model, schema and migration

**Files:**
- Modify: `tower-defence/shared/mapping.js`, `tower-defence/shared/model.js`, `tower-defence/shared/seed-sql.js`, `tower-defence/admin/catalog-validate.js`, `tower-defence/supabase/schema.sql`, `tower-defence/supabase/README.md`, tests `test/mapping.test.js`, `test/model.test.js`, `test/seed-sql.test.js`, `test/catalog-validate.test.js`
- Create: `tower-defence/supabase/migrations/2026-11-25-beer-party.sql`

**Interfaces:**
- Produces:
  - mapping: all `*FromRow`/`*ToRow` carry the new fields (shapes above). `enemyFromRow` defaults `quotes: []`, `immuneTo: []`, `fallbackSprite: r.fallback_sprite ?? (isUrl(r.sprite) ? '👤' : r.sprite)`; weapons likewise with ❔; `levelFromRow` gives `enemyIds: r.enemy_ids ?? null`, `barSprite: r.bar_sprite ?? '🍻'`.
  - `export function levelEnemyIds(level): string[]` in model.js: `level.enemyIds` when an array, else the unique enemy ids used in its waves.
  - `validateLevel`: wave groups whose `enemyId` is not in `levelEnemyIds(level)` are dropped with an error string (same as unknown enemies); a level whose `enemyIds` is an empty array is fatal ("no guests"). Cleaned level always has `enemyIds` as an array.
  - `export const IMMUNITY_EFFECTS = ['slow', 'distract', 'lure']` in catalog-validate.js; `validateEnemy` checks `quotes` is an array of non-empty strings ≤ 120 chars (max 10), `immuneTo` ⊆ IMMUNITY_EFFECTS, `fallbackSprite` non-empty and not a URL; `validateWeapon` checks `fallbackSprite` likewise.
  - `toSeedSql` writes the new columns (`quotes` jsonb, `immune_to`/`enemy_ids` text[]).
  - `schema.sql` (fresh installs) includes the new columns, the `sprites` bucket and its storage policies.
  - Migration (existing installs, idempotent): `add column if not exists` for every new column; backfill `levels.enemy_ids` from the enemy ids in `waves` where null; replace `'wine-tasting'` with `'cafe'` in every level's `weapon_ids`; delete weapon `wine-tasting`; create bucket `sprites` (public, 1 MB, the four mime types) via `insert into storage.buckets ... on conflict (id) do update`; storage policies on `storage.objects` (`select` for everyone where `bucket_id = 'sprites'`; `insert/update/delete` for `authenticated` with `bucket_id = 'sprites' and public.is_admin()`), using `drop policy if exists` first; re-issue the table grants. README: "Existing project: run the migration, then `seed.sql`. Fresh project: `schema.sql`, then `seed.sql`."

- [ ] **Step 1: Write failing tests**
  - mapping round-trips with the new fields.
  - A legacy row without the new columns maps to `quotes: []`, `immuneTo: []`, `fallbackSprite` = sprite, `enemyIds: null`, `barSprite: '🍻'`. **(RF2)**
  - `levelEnemyIds` derives ids from waves when `enemyIds` is null.
  - `validateLevel` drops a group whose guest isn't in `enemyIds` (one error string) and is fatal on `enemyIds: []`.
  - `validateEnemy` rejects `immuneTo: ['splash']`, a 121-char quote, and a URL as `fallbackSprite`.
  - `toSeedSql` output contains `immune_to` as a `text[]` literal and `quotes` as `jsonb`.
- [ ] **Step 2: Run `cd tower-defence && npm test`.** Expected: the new tests FAIL.
- [ ] **Step 3: Implement the code changes plus the SQL files and README.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS. The existing `fallback.test.js` may fail only because `enemyIds` is missing from the fallback; if so, mark that test `todo` with a note "restored in Task 2" (Task 2 removes the todo).
- [ ] **Step 5: Commit** `feat(td): data model for guests, images and guest lists`.

### Task 2: Beer content (fallback data and seed)

**Files:**
- Modify: `tower-defence/fallback-data.json`, `tower-defence/test/fallback.test.js`, `tower-defence/supabase/seed.sql` (regenerated with `npm run seed`)

**Interfaces:**
- Consumes: Task 1 shapes and `validateLevel`, `validateEnemy`, `validateWeapon`.
- Produces: `fallback-data.json` in the new shape.
  - **Weapons:** `out-of-office`, `coffee-machine`, `cafe` ("Café", `distract`, Belgian pub corner, emoji 🍻), `pizza-hut`, `hr-talk`. `wine-tasting` is removed. Each weapon has `fallbackSprite`.
  - **Guests:** `recruiter`, `sales-rep`, `quick-question`, `facilities-guy`, and `wine-snob` ("Wine Snob", 🍷, `immuneTo: ['distract']`, mid HP, slow-ish). Every guest has 2–4 good-natured `quotes`; the Wine Snob's include "This beer party isn't fun." and "Is there no Pinot?".
  - **Wording:** every description is rewritten for beer (bottle caps, kegs, beer bar).
  - **Levels:** `level-1` gets `enemyIds` for its guests and `barSprite: '🍻'`. `level-2` gets `cafe` in place of `wine-tasting`, adds `wine-snob` to its `enemyIds` and to its last three waves, and gets `barSprite`.
  - Keep `fireRate × effectDuration < 1` for `cafe` and `pizza-hut` at every tier.

- [ ] **Step 1: Update `fallback.test.js`.** Remove any `todo` from Task 1, and assert:
  - Both levels validate with zero errors.
  - `cafe` and `wine-snob` exist, and `wine-tasting` doesn't.
  - The wine snob's `immuneTo` is `['distract']`.
  - Every enemy has ≥ 2 quotes.
  - Every weapon and enemy passes `validateWeapon`/`validateEnemy`.
  - No player-facing string contains "wine table", "cork" or "Wine Tasting" (case-insensitive). The Wine Snob's own name, description and quotes are exempt.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Edit `fallback-data.json`.**
- [ ] **Step 4: Run `npm test` and `npm run seed`.** Expected: PASS, and `seed.sql` reports 5 weapons, 5 enemies, 2 levels.
- [ ] **Step 5: Commit** `feat(td): beer party content`.

### Task 3: Simulation: immunity and quote events

**Files:**
- Modify: `tower-defence/game/logic/state.js`, `tower-defence/test/state.test.js`

**Interfaces:**
- Consumes: enemy `immuneTo`, `quotes` (Task 1 shapes; treat missing as `[]`).
- Produces:
  - `new GameState(level, catalog, { rng = Math.random } = {})`.
  - **Immunity:** an effect in the target's `immuneTo` is skipped entirely: no slow, no stall, and no change to `stallImmuneUntil`. Damage is still applied, and lure/splash still hit the other guests in range normally.
  - **Quote event:** `{ type: 'quote', id, enemyId, text }`.
    - A guest with quotes speaks at spawn when `rng() < 0.35`, and may speak once more while walking (each substep with `rng() < 0.02`, at most 2 quotes per guest in total).
    - Globally, at most one quote is emitted per 1.5 s of game time.
    - Guests without quotes never speak.

- [ ] **Step 1: Write failing tests** with a stub rng:
  - An immune-to-distract guest under a distract tower keeps moving, takes damage, and its `stallImmuneUntil` stays 0. **(RF4)**
  - An immune-to-slow guest keeps its `slowFactor` at 1.
  - A non-immune guest next to it is still stalled.
  - With `rng = () => 0`, a quoted guest emits exactly one `quote` at spawn with a text from its list.
  - With `rng = () => 0.99`, no quotes are emitted.
  - The global gap: 5 quoted guests spawning together give 1 quote in the first 1.5 s.
  - A guest with `quotes: []` never emits.
  - Existing tests still pass with the default rng.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(td): guest immunities and quotes`.

### Task 4: Level generator

**Files:**
- Create: `tower-defence/shared/generator.js`, `tower-defence/test/generator.test.js`

**Interfaces:**
- Consumes: `validateLevel`, `isPathValid`, `levelEnemyIds` (Task 1).
- Produces:
  - `export const SIZES = { small: [12, 8], medium: [16, 10], large: [20, 12] }`
  - `export const DIFFICULTIES = ['chill', 'party', 'chaos']`
  - `export function canGenerate(opts, catalog): { ok: boolean, reason?: string }`.
    - Needs ≥ 1 listed guest that exists in the catalog.
    - Needs ≥ 1 listed weapon with damage > 0.
    - `waves` must be an integer from 1 to 20.
  - `export function generateLevel(opts, catalog): LevelFields`.
    - `opts = { size, difficulty, twistiness /* 0..1 */, waves, enemyIds, weaponIds, seed /* uint32 */ }`.
    - Returns `{ name: 'Generated party #' + seed, cols, rows, start, end, path, blocked, enemyIds, weaponIds, waves, startingCorks, startingWine, barSprite: '🍻' }`. It never returns an `id`, `published` or `sortOrder`; the editor keeps those from the draft.
    - Deterministic: one seeded PRNG (e.g. mulberry32) and no `Math.random`.
    - `start` sits on one board edge and `end` on a different edge. Higher twistiness gives a longer path.
    - Blocked tiles are never on the path, and the blocked density is about 6–12% of the free tiles.
    - Waves escalate:
      - Guest toughness is `hp × speed × wineDamage`.
      - Tougher guests only appear in the later half of the waves.
      - The total wave HP grows each wave.
      - Chaos produces more guests per wave and shorter intervals than Party, which in turn has more than Chill.
    - `startingCorks` scales with difficulty and the weapon costs, so the player can afford at least 2 of the cheapest listed weapon. `startingWine` is Chill 20, Party 12, Chaos 8.
  - `export function randomSeed(): number` (uses `crypto.getRandomValues`; this is the only non-deterministic function).

- [ ] **Step 1: Write failing tests.**
  - **(RF3)** Loop over 60 seeds × the 3 sizes × the 3 difficulties × twistiness {0, 0.5, 1} × waves {1, 6, 20}, with catalogs of {1 guest, 1 damage weapon} and the full fallback catalog. Each `validateLevel({ ...generated, id: 'x', sortOrder: 0, published: false }, catalog)` returns zero errors and `isPathValid` is true.
  - The same opts give a deep-equal result; a different seed gives a different path.
  - Only listed guests and weapons appear.
  - The mean path length at twistiness 1 is greater than at twistiness 0 (over 30 seeds).
  - Chaos total spawn count is greater than Chill for the same seed.
  - The toughest listed guest never appears in the first wave when waves ≥ 4.
  - `canGenerate` fails with a reason when the weapon list has no damage weapon.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS, and the loop finishes in under 5 s.
- [ ] **Step 5: Commit** `feat(td): seeded level generator`.

### Task 5: Game sprite helper and image preloading

**Files:**
- Create: `tower-defence/game/sprites-data.js` (pure), `tower-defence/game/sprites.js` (Phaser), `tower-defence/test/sprites-data.test.js`
- Modify: `tower-defence/game/scenes/BootScene.js` (preload after data loads)

**Interfaces:**
- Consumes: the data shapes from Task 1.
- Produces:
  - `sprites-data.js`:
    - `isImageSprite(s): boolean`
    - `textureKey(url): string` (stable, e.g. `'img:' + url`)
    - `collectImageUrls(data: GameData): string[]`: unique URLs from weapons, enemies and levels' `barSprite`.
  - `sprites.js`:
    - `preloadImages(scene, data): Promise<void>`. It queues `scene.load.image(textureKey(u), u)` with `crossOrigin = 'anonymous'`, resolves on complete, never rejects, records failed keys, and waits at most 6 s.
    - `makeSprite(scene, x, y, sprite, fallback, size): Phaser.GameObjects.GameObject`. It returns an Image scaled to `size` px when the texture loaded, otherwise an emoji Text of `fallback` (or of `sprite` when that isn't a URL).
  - BootScene calls `preloadImages` after `loadGameData` and before starting the menu or a level.

- [ ] **Step 1: Write failing tests** for the pure functions:
  - URL detection: http, https, emoji, empty string.
  - Dedupe in `collectImageUrls`.
  - `barSprite` URLs are included; emoji are skipped.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement both modules and the BootScene change.**
- [ ] **Step 4: Run `npm test` and `node --check` on the changed files.** Smoke-test with the stub-Phaser approach: data with one broken URL boots and `makeSprite` returns the Text fallback. **(RF1)**
- [ ] **Step 5: Commit** `feat(td): image sprites with emoji fallback`.

### Task 6: Game restyle, beer text, quote bubbles and motion

**Files:**
- Modify: `tower-defence/game/theme.js`, `game/scenes/*.js`, `game/ui/*.js`, `game/sound.js` (if any text changes), `tower-defence/index.html`, `tower-defence/style.css`, `tower-defence/play.html`
- Create (if helpful): `tower-defence/game/ui/textures.js` (bakes rounded tiles, blocks, cards and shadows into textures once per scene start)

**Interfaces:**
- Consumes:
  - `makeSprite` (Task 5) for every weapon, guest and bar icon on the board, in the build list, tower panel, HUD wave preview, menus and how-to.
  - `quote` events (Task 3).
  - Level `barSprite` (Task 1).
  - The approved mockup `.superpowers/brainstorm/2691-1795601044/content/style-c-2d-beer.html` (read it for colours and shapes).
- Produces: the approved look (spec Goal 1) and the beer text (spec Goal 2). In detail:
  - **Board:**
    - Cream floor tiles; a coral path with an inset bottom edge.
    - Raised slate-blue furniture blocks with a bottom edge and a soft shadow, keeping the furniture emoji.
    - Towers are white rounded blocks with green tier dots.
    - Guests are white rounded pieces with a slim HP bar above them.
    - The beer bar is drawn as a gold block showing `barSprite` via `makeSprite`.
  - **HUD:** white stat cards for 🧢 caps, 🍺 kegs and wave. Next wave is navy, the Victory Bell is gold, mute is white.
  - **Side panel:** build cards (faded when unaffordable, green outline when selected) and the selected-tower card.
  - **Placing:** a pastel green range circle.
  - **Quote bubbles:**
    - A white rounded bubble with a tail above the guest.
    - Shows for 2.5 s or until the guest is gone.
    - At most 3 bubbles on screen at once.
  - **Motion:**
    - Guests bob while walking.
    - Towers squash for 120 ms when they fire.
    - "+N 🧢" floats on kills.
    - Caps fly to the HUD counter on kills, at most 6 flying at a time.
  - **Text:** every visible string uses caps, kegs and the beer bar. The toast reasons become "Not enough caps 🧢" and similar.
  - **Screens:** the welcome page, menu cards, how-to (which mentions the Café, Wine Snob, Pizza Hut and Victory Bell) and end screen get the same palette and card style.
  - **Layout:** keep the existing guarantees: 1280×720 minimum, panels fit, and right-click is ignored.
  - Readability: report contrast for path vs floor, furniture vs floor, and guest/tower pieces vs floor and vs path; each must be ≥ 3:1.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Verify.**
  - `npm test` passes.
  - `node --check` passes on every changed file.
  - A stub-Phaser smoke run (not committed) covers: placing a tower, a wave with quote events (bubbles are created and destroyed, never more than 3), the bell, win and lose, and the 5×5 / 16×10 / 30×30 layouts with no overlaps.
  - A grep finds no player-facing "cork" or "wine" text outside Wine Snob content.
- [ ] **Step 3: Commit** `feat(td): pastel beer party look`.

### Task 7: Level editor: guest list, generator panel and bar image

**Files:**
- Modify: `tower-defence/admin/level-editor.js`, `tower-defence/admin/editor-state.js`, `tower-defence/admin/level-editor.css`, `tower-defence/test/editor-state.test.js`

**Interfaces:**
- Consumes:
  - `generateLevel`, `canGenerate`, `randomSeed`, `SIZES`, `DIFFICULTIES` (Task 4).
  - `levelEnemyIds` (Task 1).
  - `uploadSprite` / `validateImageFile` (Task 8).
  - The approved mockup `.superpowers/brainstorm/2691-1795601044/content/generate-panel.html`.
- Produces:
  - **New pure functions in `editor-state.js`:**
    - `setGuests(level, ids)`: the `enemyIds` array.
    - `guestsInUse(level): string[]`: guests that waves reference.
    - `applyGenerated(draft, generated)`: merges the generated fields but keeps `id`, `published` and `sortOrder`.
  - **Guest list:**
    - Guest-list chips, like the weapon chips.
    - Removing a guest that waves still use asks for confirmation and lists the affected waves; the groups are then removed.
    - The wave editor's guest dropdown only offers listed guests.
  - **Generate panel:**
    - Settings: size (segmented), difficulty (segmented), twistiness slider, waves count, and the guest and weapon chips. The chips are shared with the level's own lists.
    - **Generate** and **Re-roll** both use a new `randomSeed()`, and the seed is shown read-only as "Party #seed".
    - Generate is disabled with the `canGenerate` reason when it can't run.
    - Generating over unsaved edits asks for confirmation first, then calls `applyGenerated`. The result is dirty and unsaved.
  - **Bar image setting:** an emoji input plus Upload/Clear (via Task 8's `uploadSprite`) with a preview, stored in `barSprite`.
  - New levels default to all guests and `barSprite: '🍻'`.
  - Legacy levels with `enemyIds: null` are shown with their derived list, and saving writes the array.

- [ ] **Step 1: Write failing tests.**
  - `setGuests` doesn't mutate its input.
  - `guestsInUse` works.
  - `applyGenerated` keeps `id`, `published` and `sortOrder`.
  - A generated level passes `canSave` with the fallback catalog.
  - The legacy null `enemyIds` case is handled.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS. Also do a jsdom smoke run (not committed, no dependency added to `package.json`): Generate, Re-roll, Save enabled, Play URL, and the guest-removal confirmation.
- [ ] **Step 5: Commit** `feat(td): level generator and guest lists in the editor`.

### Task 8: Catalog editors (quotes, immunities, images) and the upload module

**Files:**
- Create: `tower-defence/admin/upload-validate.js` (pure), `tower-defence/admin/upload.js`, `tower-defence/test/upload-validate.test.js`
- Modify: `tower-defence/admin/catalog-editor.js`, `tower-defence/admin/admin.css`

**Interfaces:**
- Consumes:
  - `validateEnemy` / `validateWeapon` / `IMMUNITY_EFFECTS` (Task 1).
  - `state.dataSource`, plus the supabase client exposed by `admin.js`. Check how `admin.js` obtains it (dynamic import); if needed, export `state.client` from `admin.js` in this task.
- Produces:
  - **`upload-validate.js`:**
    - `MAX_BYTES = 1048576`
    - `ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']`
    - `validateImageFile({ type, size }): string | null`
    - `objectPathFor(file): string` (`<uuid>.<ext>`)
    - `storagePathFromUrl(url): string | null`
  - **`upload.js`:**
    - `uploadSprite(client, file): Promise<{ ok: true, url } | { ok: false, error }>`, using `client.storage.from('sprites').upload` then `getPublicUrl`.
    - `removeSprite(client, url): Promise<void>` is best effort and never throws.
  - **Guest editor:**
    - A quotes list (add, edit, remove lines).
    - Immune-to checkboxes for `IMMUNITY_EFFECTS`.
    - An image box with Upload and Clear, plus a preview.
    - A fallback emoji input.
  - **Weapon editor:** the same image box and fallback emoji input.
  - **Image behaviour:**
    - Uploading sets `sprite` to the URL.
    - Clear sets `sprite` back to `fallbackSprite`.
    - Replacing an uploaded image calls `removeSprite` on the old URL after the new save succeeds.
    - All of this is disabled when `state.readOnly`.

- [ ] **Step 1: Write failing tests** for `upload-validate.js`:
  - It rejects `image/gif`, rejects 1048577 bytes, and accepts 1048576 bytes of PNG. **(RF5)**
  - `objectPathFor` keeps the extension.
  - `storagePathFromUrl` round-trips a `getPublicUrl`-style URL and returns null for foreign URLs.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Upload errors show inline and buttons always re-enable (try/finally).
- [ ] **Step 4: Run `npm test` and `node --check`.** Also do a jsdom smoke run with a fake client: upload ok, upload error, oversize rejected before the call.
- [ ] **Step 5: Commit** `feat(td): guest quotes, immunities and image uploads in the editor`.

### Task 9: Admin restyle, readability and wrap-up

**Files:**
- Modify: `tower-defence/admin/admin.css`, `tower-defence/admin/level-editor.css`, `tower-defence/admin/index.html` (title and labels if needed), `REGRET.md`, `tower-defence/supabase/README.md`

- [ ] **Step 1: Apply the pastel palette and card style to the admin pages.** Use white cards, chunky buttons and the same colours as `game/theme.js`, mirrored as CSS variables. Editor map colours should match the game: coral path, slate furniture blocks, gold bar.
- [ ] **Step 2: Update the admin text.** Every admin-facing label says caps, kegs and beer bar, e.g. "Starting caps", "Starting kegs", "Kegs drained".
- [ ] **Step 3: Write the README "Upgrade an existing project" section.** In order: run the migration, then `seed.sql`, then check the Storage bucket exists, then check the console says `Game data loaded from db.`
- [ ] **Step 4: Verify.** `npm test` passes. `node --check` passes on the changed JS. curl returns 200 for the admin and play pages.
- [ ] **Step 5: Commit** `polish(td): admin restyle and upgrade notes`.

---

## Execution waves (parallel)

W1: Task 1, Task 3 · W2: Task 2, Task 4, Task 5, Task 8 · W3: Task 6, Task 7 · W4: Task 9

## Self-review notes

- Each spec goal maps to tasks:
  - Look: Tasks 6 and 9.
  - Beer theme: Tasks 2, 6 and 9.
  - Café: Task 2.
  - Wine Snob: Tasks 2 and 3.
  - Quotes and immunity as data: Tasks 1, 3 and 8.
  - Guest list per level: Tasks 1 and 7.
  - Generator: Tasks 4 and 7.
  - Custom images: Tasks 1, 5, 7 and 8.
  - Migration and seed: Tasks 1 and 2.
  - The settled builder questions 1–7: Tasks 3, 5, 7, 4, 2, 1 and 8.
- Builder's calls fixed here:
  - Quote probabilities: 0.35 at spawn, 0.02 per substep, 1.5 s global gap, max 2 per guest.
  - Bubbles: 2.5 s, max 3 on screen.
  - Image preload timeout: 6 s.
  - Generator: blocked density 6–12%, starting kegs Chill 20 / Party 12 / Chaos 8.
  - Quote limits: max 10 quotes, 120 characters each.
