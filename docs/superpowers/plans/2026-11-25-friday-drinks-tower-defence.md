# Friday Afternoon Drinks Tower Defence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A data-driven browser tower defence game ("Friday Afternoon Drinks") on GitHub Pages, with levels/weapons/enemies in Supabase and an admin-only level editor.

**Architecture:** All game rules live in a pure, framework-free simulation (`game/logic/`) that is unit-tested with Node's built-in test runner; Phaser scenes only render that state and forward input. A shared data layer loads catalog + levels from Supabase (injected client) and falls back to a bundled `fallback-data.json`. The admin editor is plain DOM, with its grid logic in a pure, tested module.

**Tech Stack:** Native ES modules (no build step), Phaser 3.90.0 from jsDelivr, supabase-js 2.57.4 (already in `tower-defence/supabase.js`), Node 26 `node --test` for unit tests, WebAudio-synthesised sound effects.

**Spec:** `docs/superpowers/specs/2026-11-25-friday-drinks-tower-defence-design.md`

## Global Constraints

- No build step. Everything is served as-is by GitHub Pages from `main`; every commit on `main` goes live.
- Modules under `tower-defence/shared/`, `tower-defence/game/logic/` and `tower-defence/admin/editor-state.js` must not import CDN URLs or touch the DOM, so Node can test them. Only entry files import `supabase.js` or Phaser.
- Only the Supabase **publishable** key may appear in code. Never the service-role/secret key.
- Currency is **wine corks**; lives are **wine** (bottles). UI language: English.
- Nexios references in mechanics: Wine Tasting (distract), Pizza Hut Delivery (lure, enemies stay on the path), Nexios Victory Bell (once per level, clears the screen, pays rewards).
- Phaser URL: `https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js`.
- In-app data shapes are camelCase (below); DB columns are snake_case; only `shared/mapping.js` converts.
- Every task ends with `cd tower-defence && npm test` green (where tests exist) and a commit. Add a line to `/REGRET.md` whenever something that worked breaks.

### Data shapes (used by every task)

```js
// Weapon
{ id, name, description, sprite, cost, range, damage, fireRate,
  effect /* 'none'|'slow'|'distract'|'lure'|'splash' */, effectStrength, effectDuration,
  upgrades: [{ cost, damage?, range?, fireRate?, effectStrength? }] } // absolute values, not deltas
// Enemy
{ id, name, description, sprite, hp, speed /* tiles/s */, reward, wineDamage }
// Level
{ id, name, sortOrder, published, cols, rows, start: {x,y}, end: {x,y},
  path: [{x,y}], blocked: [{x,y}], weaponIds: [id], startingCorks, startingWine,
  waves: [[{ enemyId, count, intervalS, delayS }]] }
// GameData
{ weapons: Weapon[], enemies: Enemy[], levels: Level[], source: 'db'|'fallback' }
```

IDs are text. Seeded/fallback IDs are slugs (`wine-tasting`, `recruiter`, `level-1`); editor-created ones use `crypto.randomUUID()`.

## Review Focus

1. **Supabase unreachable, slow (>3 s) or returning no valid levels**: the game still starts on fallback data; only the console mentions it. (Task 7 tests.)
2. **An admin edit leaves a level broken** (gap in path, deleted weapon/enemy still referenced, no waves): the game skips or cleans that level and the others stay playable; the editor refuses to save a broken path. (Tasks 1, 9 and 10 tests.)
3. **Grid resized smaller than existing content**: out-of-bounds path/blocked tiles are dropped, start/end cleared if outside, with a visible warning. (Task 9 test.)
4. **Player actions at the wrong moment**: building on path/blocked/occupied tiles, without enough corks, upgrading past the last tier, ringing the bell twice, starting a wave mid-wave: all no-ops with a reason, never a crash or negative corks. (Task 4 tests.)
5. **Huge frame delta** (tab in background, then back): the simulation caps time per tick so enemies don't teleport past towers to the wine table. (Task 4 test.)

---

### Task 1: Test harness, data shapes validation and mapping

**Files:**
- Create: `tower-defence/package.json`, `tower-defence/shared/model.js`, `tower-defence/shared/mapping.js`, `tower-defence/test/model.test.js`, `tower-defence/test/mapping.test.js`, `REGRET.md`

**Interfaces:**
- Produces:
  - `isPathValid(path, start, end, cols, rows): boolean` (in bounds, orthogonally adjacent steps, no repeats, first = start, last = end, length ≥ 2)
  - `validateLevel(level, catalog: {weapons, enemies}): { level: Level|null, errors: string[] }`. Cleans: drops `weaponIds` not in catalog, wave groups with unknown `enemyId` or `count < 1`, waves left empty, `blocked` tiles out of bounds or on the path. Returns `level: null` when the path is invalid, no weapons remain or no waves remain.
  - `prepareGameData(raw: {weapons, enemies, levels}, { includeUnpublished = false } = {}): { weapons, enemies, levels }`, with levels validated, unpublished removed unless requested, and sorted by `sortOrder`.
  - `mapping.js`: `weaponFromRow/weaponToRow`, `enemyFromRow/enemyToRow`, `levelFromRow/levelToRow` (snake_case ↔ camelCase; `levelToRow` omits nothing, `*FromRow` defaults missing arrays to `[]`).

- [ ] **Step 1: Create `tower-defence/package.json`** with `{"name":"friday-drinks","private":true,"type":"module","scripts":{"test":"node --test test/"}}` and `REGRET.md` with a heading `# Regret log` and the line format `- YYYY-MM-DD HH:MM: what broke, why`.

- [ ] **Step 2: Write failing tests in `test/model.test.js`**

```js
test('isPathValid accepts an orthogonal chain from start to end', () => {
  assert.equal(isPathValid([{x:0,y:0},{x:1,y:0},{x:1,y:1}], {x:0,y:0}, {x:1,y:1}, 3, 3), true);
});
test('isPathValid rejects diagonal steps, gaps, repeats, out of bounds and wrong ends', () => {
  assert.equal(isPathValid([{x:0,y:0},{x:1,y:1}], {x:0,y:0}, {x:1,y:1}, 3, 3), false);
  assert.equal(isPathValid([{x:0,y:0},{x:2,y:0}], {x:0,y:0}, {x:2,y:0}, 3, 3), false);
  assert.equal(isPathValid([{x:0,y:0},{x:1,y:0},{x:0,y:0}], {x:0,y:0}, {x:0,y:0}, 3, 3), false);
  assert.equal(isPathValid([{x:2,y:0},{x:3,y:0}], {x:2,y:0}, {x:3,y:0}, 3, 3), false);
  assert.equal(isPathValid([{x:0,y:0},{x:1,y:0}], {x:0,y:0}, {x:2,y:0}, 3, 3), false);
});
test('validateLevel drops unknown weapons and enemy groups but keeps the level', () => { /* level with weaponIds ['a','gone'], waves [[{enemyId:'e',...},{enemyId:'gone',...}]] → weaponIds ['a'], one group, errors.length === 2 */ });
test('validateLevel returns null for a broken path, no weapons, or no waves', () => { /* three cases, each level === null */ });
test('validateLevel drops blocked tiles on the path or out of bounds', () => {});
test('prepareGameData hides unpublished levels unless includeUnpublished and sorts by sortOrder', () => {});
```

- [ ] **Step 3: Write failing round-trip tests in `test/mapping.test.js`**: `levelFromRow(levelToRow(level))` deep-equals `level` (same for weapon and enemy); `levelToRow(level).starting_corks === level.startingCorks`.
- [ ] **Step 4: Run `cd tower-defence && npm test`.** Expected: FAIL (modules missing).
- [ ] **Step 5: Implement `shared/model.js` and `shared/mapping.js`.**
- [ ] **Step 6: Run `npm test`.** Expected: all pass.
- [ ] **Step 7: Commit** `feat(td): data model validation and DB mapping`.

### Task 2: Starter content (fallback data)

**Files:**
- Create: `tower-defence/fallback-data.json`, `tower-defence/test/fallback.test.js`

**Interfaces:**
- Consumes: `prepareGameData` (Task 1).
- Produces: `fallback-data.json` = `{ weapons, enemies, levels }` in app shape. Content, with balance numbers left to the builder:
  - Weapons: `out-of-office` (Out-of-Office Reply, `none`, cheap basic damage), `coffee-machine` (`slow`), `wine-tasting` (Wine Tasting, `distract`), `pizza-hut` (Pizza Hut Delivery, `lure`, damage 0), `hr-talk` (HR Talk, `splash`). Each has 2 upgrade tiers. Sprites are emoji for now.
  - Enemies: `recruiter`, `sales-rep`, `quick-question` (fast, low HP), `facilities-guy` (slow, tanky, high `wineDamage`).
  - Levels: `level-1` "First Round" (16×10, 3 weapons, 5 waves) and `level-2` "Last Call" (18×12, all weapons, 8 waves, a winding path with blocked tiles), both published.

- [ ] **Step 1: Write the failing test:** loading the file with `fs` and running `prepareGameData` returns 2 levels with zero `errors` from `validateLevel` for each, and every weapon has `upgrades.length === 2`.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL (file missing).
- [ ] **Step 3: Author `fallback-data.json`.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(td): starter weapons, guests and levels`.

### Task 3: Simulation building blocks (path, waves, stats)

**Files:**
- Create: `tower-defence/game/logic/path.js`, `waves.js`, `stats.js`; `tower-defence/test/logic-basics.test.js`

**Interfaces:**
- Produces:
  - `pathLength(path): number`: number of segments (tiles walked), `path.length - 1`.
  - `positionAt(path, distance): {x, y}`: tile-centre coordinates (`x + 0.5`), interpolated along segments; clamped to `[0, pathLength]`.
  - `buildSpawnSchedule(wave): Array<{ time: number, enemyId: string }>`: each group spawns `count` enemies at `delayS + i * intervalS` (groups run concurrently from wave start); sorted by time, ties keep group order.
  - `weaponStats(weapon, tier): { damage, range, fireRate, effectStrength }`: tier 0 is base; tier n applies `upgrades[0..n-1]` in order, each overriding only the fields it sets.
  - `upgradeCost(weapon, tier): number | null`: cost of going from `tier` to `tier + 1`, `null` at max.

- [ ] **Step 1: Write failing tests:**
  - `positionAt` on `[{0,0},{1,0},{1,1}]` gives `{x:1.5,y:0.5}` at distance 1 and `{x:1.5,y:1}` at distance 1.5, and clamps at −1 and at 99.
  - `buildSpawnSchedule([{enemyId:'a',count:2,intervalS:1,delayS:0},{enemyId:'b',count:1,intervalS:1,delayS:0.5}])` deep-equals `[{0,'a'},{0.5,'b'},{1,'a'}]` (as objects).
  - `weaponStats` at tier 2 with upgrades `[{damage:5},{range:3}]` has damage 5 and range 3.
  - `upgradeCost` at max tier is `null`.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement the three modules.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(td): path, wave schedule and weapon stats`.

### Task 4: GameState simulation

**Files:**
- Create: `tower-defence/game/logic/state.js`, `tower-defence/test/state.test.js`

**Interfaces:**
- Consumes: Task 3 functions; `Level`, `Weapon`, `Enemy` shapes.
- Produces `class GameState`:
  - `constructor(level, { weapons, enemies })`
  - Fields: `corks`, `wine`, `phase: 'build'|'wave'|'won'|'lost'`, `waveIndex` (waves started so far), `totalWaves`, `towers: [{id, x, y, weaponId, tier, spent, cooldown}]`, `enemies: [{id, enemyId, hp, maxHp, distance, stallUntil, slowUntil, slowFactor}]`, `bellUsed`, `time`.
  - `tileType(x, y): 'path'|'blocked'|'tower'|'buildable'|'outside'`
  - `placeTower(x, y, weaponId): { ok: boolean, reason?: 'not-buildable'|'not-in-level'|'no-corks'|'game-over' }`
  - `upgradeTower(towerId): { ok, reason?: 'max-tier'|'no-corks'|'unknown' }`
  - `sellTower(towerId): { ok, refund? }`: refund `Math.floor(spent / 2)`.
  - `startNextWave(): { ok, reason?: 'wave-running'|'no-waves'|'game-over' }`
  - `ringBell(): { ok, reason?: 'used'|'game-over' }`: removes all enemies, adds their `reward`, sets `bellUsed`.
  - `tick(dt)`: caps total simulated time per call at 0.25 s and steps in ≤ 0.05 s substeps. Each substep spawns from the schedule, moves enemies (`speed × slowFactor`, 0 while stalled), lets towers whose cooldown has elapsed fire at the in-range enemy with the greatest `distance` (range measured centre to centre in tiles), applies the effect, pays out kills, and subtracts `wineDamage` for enemies that pass `pathLength` (removing them). Phase changes: `wave` → `build` when the schedule is done and no enemies remain; → `won` after the last wave; → `lost` when `wine <= 0`.
  - Effects: `slow` sets `slowFactor = 1 - effectStrength` for `effectDuration`; `distract` stalls the target for `effectDuration`; `lure` stalls **all** enemies in range for `effectDuration` (they stay on the path); `splash` damages every enemy within `effectStrength` tiles of the target. Effects refresh rather than stack.
  - `drainEvents(): Array<{ type: 'spawn'|'shot'|'kill'|'leak'|'bell'|'wave-cleared'|'won'|'lost', ... }>`, consumed by rendering and sound.

- [ ] **Step 1: Write failing tests** with a tiny inline level (5×3, straight path, 1 wave of 2 enemies). The Review Focus #4 and #5 tests are marked:
  - `placeTower` on a path tile → `{ok:false, reason:'not-buildable'}`; on an occupied tile → `'not-buildable'`; with too few corks → `'no-corks'`, and corks are unchanged. **(RF4)**
  - Placing a weapon not in `level.weaponIds` → `'not-in-level'`.
  - `upgradeTower` past the last tier → `'max-tier'`; `ringBell` twice → second call `'used'`; `startNextWave` while a wave runs → `'wave-running'`. **(RF4)**
  - With no towers and enough time ticked, enemies leak: `wine` drops by the sum of `wineDamage`, and the phase becomes `lost` when wine reaches 0.
  - A tower with high damage next to the path kills both enemies: corks increase by their rewards, and the phase becomes `won` after the only wave.
  - A single `tick(10)` advances an enemy no more than `speed × 0.25` tiles. **(RF5)**
  - `lure` stalls every enemy in range, and their `distance` does not change while stalled.
  - `ringBell` mid-wave empties `enemies` and pays out rewards.
  - `sellTower` after one upgrade refunds `floor((cost + upgradeCost) / 2)`.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `state.js`.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(td): game simulation`.

### Task 5: Phaser game shell on fallback data

**Files:**
- Create: `tower-defence/play.html`, `tower-defence/game/main.js`, `tower-defence/game/scenes/BootScene.js`, `MenuScene.js`, `GameScene.js`, `tower-defence/game/theme.js`
- Modify: `tower-defence/index.html` (enable the button as a "Play" link to `play.html`, add a small "Admin" link to `admin/`), `tower-defence/style.css`

**Interfaces:**
- Consumes: `prepareGameData` (Task 1), `fallback-data.json` (Task 2), `GameState` (Task 4).
- Produces:
  - `theme.js` exports `PALETTE` (floor, path, blocked, buildable-hover, invalid-hover, HUD text, accent) and `TILE = 64`, the single source of colours for the game. The palette is a warm office-party one, and the path must contrast clearly with the floor.
  - Phaser config uses `Scale.FIT`. BootScene loads data and stores `GameData` in `this.registry.set('data', …)`. MenuScene lists levels and starts `GameScene` with `{ levelId }`. GameScene owns one `GameState`, calls `state.tick(delta / 1000)` in `update`, and renders the grid, path, blocked tiles, towers, enemies (sprite emoji plus an HP bar) and wine table from state. It reads `drainEvents()` each frame.
  - URL params: `?level=<id>` skips the menu; `?preview=1` includes unpublished levels (used by the editor).
- For now BootScene uses `fetch('fallback-data.json')` directly; Task 7 replaces it.

- [ ] **Step 1: Build the files.**
- [ ] **Step 2: Verify manually.** Run `npx --yes http-server . -p 8000 -c-1` from the repo root, open `http://localhost:8000/tower-defence/`, click Play, and pick "First Round". Expected: the grid renders, the path is clearly visible, and the welcome page's back link still reaches the overview. (Waves aren't playable until Task 6.)
- [ ] **Step 3: Commit** `feat(td): Phaser game shell`.

### Task 6: Playable loop: HUD, building, upgrades, bell, end screens, sound

**Files:**
- Create: `tower-defence/game/ui/Hud.js`, `tower-defence/game/ui/BuildMenu.js`, `tower-defence/game/ui/TowerPanel.js`, `tower-defence/game/scenes/EndScene.js`, `tower-defence/game/sound.js`
- Modify: `tower-defence/game/scenes/GameScene.js`, `tower-defence/game/main.js`

**Interfaces:**
- Consumes: `GameState` methods and events (Task 4), `PALETTE`/`TILE` (Task 5), `weaponStats`/`upgradeCost` (Task 3).
- Produces:
  - **HUD:** shows corks 🍾, wine 🍷 and "Wave n/total", plus "Next wave" (enabled only in `build`), "🔔 Victory Bell" (disabled once used) and a mute toggle.
  - **Build menu:** lists the level's weapons with cost, greyed out when unaffordable. Selecting one shows a range circle and a green/red tile highlight from `tileType`. A failed place shows the `reason` as a short toast.
  - **Tower panel:** clicking a tower shows its stats, "Upgrade (cost)" and "Sell (+refund)".
  - **End scene:** won or lost, with "Retry" and "Levels".
  - **Sound (`sound.js`):** `createSound(): { play(name: 'shot'|'cork'|'leak'|'bell'|'won'|'lost'), setMuted(bool), muted }`, short WebAudio-synthesised effects with no audio files. Mute is remembered in `localStorage` (wrapped in try/catch). Events map to sounds: `kill`→cork, `leak`→leak, `bell`→bell, `won`/`lost`.
  - **Visual feedback:** a shot line or tween per `shot` event, a "+n 🍾" float text per `kill`, and a screen shake plus a gold flash for `bell`. Stalled guests visibly wobble or lean toward the Pizza Hut tower.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Verify manually** on the local server. You can win "First Round" with a sensible build and lose it by building nothing. The bell clears the screen once and its button greys out. Upgrade and sell change corks by the expected amounts. Mute persists across reloads. Switching tabs for 10 s mid-wave doesn't make guests skip towers.
- [ ] **Step 3: Run `npm test`.** Expected: PASS (no logic regressions).
- [ ] **Step 4: Commit and push** `feat(td): playable game loop`. Check the live site at `https://rokeppen.github.io/tower-defence/`.

### Task 7: Supabase schema and data layer with fallback

**Files:**
- Create: `tower-defence/supabase/schema.sql`, `tower-defence/supabase/seed.sql`, `tower-defence/supabase/README.md`, `tower-defence/shared/data.js`, `tower-defence/test/data.test.js`, `tower-defence/scripts/make-seed.js`
- Modify: `tower-defence/game/scenes/BootScene.js`, `tower-defence/package.json` (add a `"seed": "node scripts/make-seed.js"` script)

**Interfaces:**
- Consumes: `mapping.js`, `prepareGameData`, `supabase` from `tower-defence/supabase.js` (injected by entry files only).
- Produces:
  - **`schema.sql`:**
    - Tables `weapons`, `enemies`, `levels` (text `id` primary key; jsonb `upgrades`, `start`, `end`, `path`, `blocked`, `waves`; text[] `weapon_ids`; `published boolean default false`; `sort_order int default 0`) and `admins(user_id uuid primary key references auth.users on delete cascade)`.
    - A `security definer` function `public.is_admin()` that returns whether `auth.uid()` is in `admins`.
    - RLS is enabled on all four tables. Policies: `select` to `anon, authenticated` on weapons, enemies and levels; `insert/update/delete` to `authenticated` using/with check `is_admin()`; on `admins`, `select` only where `user_id = auth.uid()`.
  - **`seed.sql`:** generated by `npm run seed` from `fallback-data.json` (upserts on `id`).
  - **`README.md`:** the handoff steps for the author:
    1. Paste `schema.sql`, then `seed.sql`, into the SQL editor.
    2. Under Authentication, create a user with email and password.
    3. Run `insert into admins(user_id) values ('<uuid>');`.
    4. Disable sign-ups under Authentication → Sign In / Providers.
  - **`data.js`:**
    - `createDataSource({ client, fetchFallback, timeoutMs = 3000 })` returns:
      - `loadGameData({ includeUnpublished }): Promise<GameData>`
      - `saveLevel(level)`, `deleteLevel(id)`, `saveWeapon(w)`, `deleteWeapon(id)`, `saveEnemy(e)`, `deleteEnemy(id)`: each `Promise<{ ok, error? }>`
      - `exportJson(): Promise<string>`: pretty-printed `{weapons, enemies, levels}` in app shape, including unpublished levels.
    - `loadGameData` returns `source:'db'` only if the DB answered within `timeoutMs` **and** `prepareGameData` yields ≥ 1 level. Otherwise it returns the fallback with `source:'fallback'` and `console.warn`s the reason.
  - **BootScene** builds the data source with the real client and `() => fetch('fallback-data.json').then(r => r.json())`. If both sources fail, it shows "The party is cancelled: couldn't load levels. Try reloading." instead of a blank canvas.

- [ ] **Step 1: Write failing tests in `data.test.js`** using a fake client (`from(table).select()` resolving with rows) and a fake fallback. **(RF1)**
  - The DB returns valid rows → `source === 'db'`.
  - The DB rejects → `'fallback'`.
  - The DB never resolves with `timeoutMs: 20` → `'fallback'` within 200 ms.
  - The DB returns only invalid or unpublished levels → `'fallback'`.
  - `includeUnpublished: true` returns unpublished DB levels.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `data.js`, `schema.sql`, `make-seed.js` (writes `seed.sql`), and `README.md`; update BootScene.**
- [ ] **Step 4: Run `npm test` and `npm run seed`.** Expected: tests PASS, and `supabase/seed.sql` contains 5 weapons, 4 enemies and 2 levels.
- [ ] **Step 5: Commit and push** `feat(td): Supabase schema and data layer with fallback`.
- [ ] **Step 6: HANDOFF.** Ask the author to follow `supabase/README.md` and confirm. Then verify: the game's console shows no fallback warning, so data came from the DB. A `curl` POST to `/rest/v1/levels` with only the publishable key is rejected (401/403), which proves RLS blocks anonymous writes.

### Task 8: Admin shell: login, admin check, tabs, export

**Files:**
- Create: `tower-defence/admin/index.html`, `tower-defence/admin/admin.js`, `tower-defence/admin/admin.css`

**Interfaces:**
- Consumes: `supabase` client, `createDataSource` (Task 7).
- Produces:
  - **Views:**
    - Signed out: an email and password form (`supabase.auth.signInWithPassword`) with an inline error.
    - Signed in but not admin (checked with `select` from `admins`): the message "You're not on the guest list." plus "Sign out".
    - Admin: tabs **Levels | Weapons | Enemies**, "Export JSON" (downloads `fallback-data.json`) and "Sign out".
  - `admin.js` exports `state = { data: GameData, dataSource }` and `refresh(): Promise<void>` (reloads with `includeUnpublished: true`) for the editors in Tasks 9–11, and mounts each tab with `mountLevels(el)`, `mountWeapons(el)` and `mountEnemies(el)`. Until those exist, each is a stub showing "Coming up".
  - Styling: plain DOM in the game's `PALETTE` colours, readable on a laptop.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Verify manually.**
  - A wrong password shows the error.
  - The admin account sees the tabs.
  - A non-admin account, if one exists, sees the guest-list message.
  - Export downloads valid JSON that passes `prepareGameData` (check with `node -e`).
- [ ] **Step 3: Commit** `feat(td): admin login and shell`.

### Task 9: Level editor: grid, start/end, path, blocked tiles

**Files:**
- Create: `tower-defence/admin/editor-state.js`, `tower-defence/test/editor-state.test.js`, `tower-defence/admin/level-editor.js`
- Modify: `tower-defence/admin/admin.js` (replace the Levels stub)

**Interfaces:**
- Consumes: `isPathValid`, `validateLevel` (Task 1), `state`/`refresh`/`dataSource` (Task 8).
- Produces:
  - `newLevel(): Level`: 16×10, no start/end, empty path, blocked and waves, `startingCorks: 100`, `startingWine: 20`, `published: false`, id from `crypto.randomUUID()`.
  - `setStart(level, tile)` / `setEnd(level, tile)`: both clear the path when they change.
  - `extendPath(level, tile): Level`:
    - When the path is empty, it only accepts `start`.
    - Clicking the last tile removes it.
    - It appends a tile that is orthogonally adjacent to the last one, in bounds, and not already in the path; the tile is removed from `blocked` if it was there.
    - Otherwise it returns the level unchanged.
  - `toggleBlocked(level, tile): Level`: ignores path, start and end tiles.
  - `resizeLevel(level, cols, rows): { level, warnings: string[] }`: drops out-of-bounds blocked and path tiles. If start or end falls outside, it clears that and the whole path. If the path is cut, it truncates the path at the first out-of-bounds tile. One warning per kind of loss.
  - `canSave(level, catalog): { ok, errors }`: `isPathValid` plus `validateLevel(...).level !== null`.
  - **UI:**
    - A level list (name, published ✓, sort order) with New / Duplicate / Delete (delete asks for confirmation).
    - Tools Start / End / Path / Blocked / Erase.
    - Columns and rows inputs, 5–30 each.
    - A clickable CSS-grid map: start is S, end is E, the path is shown in order, blocked tiles are ✕.
    - Name and published fields.
    - "Save" is disabled with the reasons listed while `canSave` is not ok.
    - Resize warnings show as a banner.

- [ ] **Step 1: Write failing tests:**
  - `extendPath` refuses a non-start first tile, a diagonal tile and a repeat.
  - `extendPath` removes the last tile when it's clicked again.
  - `toggleBlocked` on a path tile → unchanged.
  - **(RF3)** `resizeLevel` from 16×10 to 8×10 with the end at x=15 → `end === null`, `path` is empty, and `warnings` is non-empty.
  - **(RF2)** `canSave` with a gap in the path → `ok:false`.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `editor-state.js` and `level-editor.js`.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Verify manually:**
  - Draw a new level, save it, reload: it persists.
  - A broken path can't be saved.
- [ ] **Step 6: Commit** `feat(td): level editor map tools`.

### Task 10: Level editor: weapons, waves, settings, play-test

**Files:**
- Modify: `tower-defence/admin/level-editor.js`, `tower-defence/admin/editor-state.js`, `tower-defence/test/editor-state.test.js`

**Interfaces:**
- Consumes: Task 9 functions and `state.data.weapons`/`enemies`.
- Produces:
  - `setWeapons(level, ids)`.
  - `addWave(level)`: copies the previous wave, or adds `[{enemyId: firstEnemy, count: 5, intervalS: 1, delayS: 0}]`.
  - `removeWave(level, i)`, `moveWave(level, i, dir)`.
  - `addGroup(level, waveIdx, enemyId)`, `updateGroup(level, waveIdx, groupIdx, patch)`, `removeGroup(level, waveIdx, groupIdx)`.
  - All of these return a new `Level`.
  - **UI:**
    - Weapon checkboxes showing each weapon's emoji and cost.
    - Starting corks and starting wine inputs.
    - A wave list with rows of enemy select, count, interval and delay, plus add/remove/reorder, and a per-wave summary such as "6 🧑‍💼 + 2 ❓".
    - "Play this level" opens `../play.html?level=<id>&preview=1` in a new tab after saving.

- [ ] **Step 1: Write failing tests:**
  - `addWave` on an empty level creates one group.
  - `moveWave` swaps the order.
  - `updateGroup` with `{count: 0}` makes `canSave` fail.
  - **(RF2)** A level referencing a deleted enemy loads with that group dropped and shows a warning in the editor. `validateLevel` errors are surfaced, not swallowed.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Verify manually:**
  - Build a 3-wave level and play-test it via the button.
  - Publish it: it appears in the game's level menu.
- [ ] **Step 6: Commit and push** `feat(td): level editor waves and weapons`.

### Task 11: Weapon and enemy catalog editors

**Files:**
- Create: `tower-defence/admin/catalog-editor.js`
- Modify: `tower-defence/admin/admin.js` (replace the Weapons and Enemies stubs)

**Interfaces:**
- Consumes: `dataSource.saveWeapon/deleteWeapon/saveEnemy/deleteEnemy`, `refresh` (Task 8).
- Produces:
  - `mountWeapons(el)`: a list plus a form for every Weapon field. The effect is a select; effect fields are shown only when the effect isn't `none`. The upgrades table allows add/remove of a tier, and each tier has cost plus optional overrides.
  - `mountEnemies(el)`: a list plus a form for every Enemy field.
  - Numbers must be > 0, except `damage` and `effectStrength` (≥ 0).
  - Deleting a weapon or enemy that a level uses first lists those levels and asks for confirmation. Those levels are then cleaned on load by `validateLevel`.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Verify manually:**
  - Create a new weapon and enable it in a level: it's buildable in-game with the new stats.
  - Delete an enemy used by a level: the warning lists the level, and the game still loads that level without that enemy group.
- [ ] **Step 3: Run `npm test`.** Expected: PASS.
- [ ] **Step 4: Commit and push** `feat(td): weapon and enemy catalog editors`.

### Task 12: Polish pass and final fallback refresh

**Files:**
- Modify: game scenes and UI, `tower-defence/index.html`/`style.css` (welcome page in the theme: "Friday Afternoon Drinks", a short story line, Play and Admin), `fallback-data.json`, `REGRET.md`

- [ ] **Step 1: Restyle the welcome page** to the theme and palette. The back link to the overview stays.
- [ ] **Step 2: Add a title/menu screen** with level cards and the best wave reached (`localStorage`, try/catch). Add a short "how to play" overlay on first launch.
- [ ] **Step 3: Refresh the fallback.** Export JSON from the admin and commit it as `fallback-data.json`, then run `npm test`. Expected: PASS (fallback still valid).
- [ ] **Step 4: Readability check.** At 1280×720 and at a narrow laptop window, towers, guests, the path and blocked tiles can be told apart at a glance.
- [ ] **Step 5: Commit and push** `polish(td): theme, menus and refreshed fallback`. Verify the live site end to end: overview → tower defence → play a level → admin login.

---

## Self-review notes

- **Spec coverage:**
  - Theme and currency: Tasks 2, 5, 6 and 12.
  - Nexios mechanics: Tasks 2, 4 and 6.
  - Upgrades: Tasks 3, 4 and 6.
  - Sound and menus: Tasks 6 and 12.
  - Fallback: Tasks 2 and 7.
  - RLS and admins: Task 7.
  - Editor steps 1–7: Tasks 9–11.
  - "Play this level": Task 10.
  - Export JSON: Task 8.
  - REGRET.md: Task 1.
  - Leaderboard and save games are non-goals and get no task.
- **Builder's calls fixed here:**
  - Upgrade tiers hold absolute values.
  - Wave groups run concurrently, offset by `delayS`.
  - The sell refund is 50%.
  - Lure stalls everything in range; distract stalls a single target.
  - Sound is synthesised, with no audio assets.
  - Tick time is capped at 0.25 s per call.
