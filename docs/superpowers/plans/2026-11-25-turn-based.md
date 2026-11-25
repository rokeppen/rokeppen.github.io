# Turn-based Play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace real-time play with the author's turn-based rules: 3 actions per player turn (10 🧢 per unused action), guests move tile by tile up to their speed, towers fire as often as their fire rate allows after each step.

**Architecture:** A new pure turn engine replaces the real-time simulation in `game/logic/state.js` (same class name `GameState`, new API). The guests' turn resolves synchronously into an ordered event list, which `GameScene` plays back as animation. Data, editor, Supabase and look stay; admin labels change from seconds to turns.

**Tech Stack:** Native ES modules (no build step), Phaser 3.90.0, Node 26 `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-25-turn-based-design.md`. Read the "Turn engine rules (precise)" and "Settled after builder review" sections; they are binding.

## Global Constraints

- No build step, no npm dependencies. `game/logic/` stays pure: no Phaser, no DOM, no CDN imports.
- **1 s in data = 1 turn.** Durations round up with `ceil`; spawn times round down with `floor`. Speeds below 0.1 are clamped to 0.1.
- Player turn: 3 actions (place, upgrade, sell), refusal reason `'no-actions'`. `endTurn` pays `10 × actionsLeft` caps (internal `corks`). The bell is free and still once per level.
- Waves are automatic: the first wave starts in the guests' turn of turn 1, each next wave 2 guests' turns after the previous one is cleared. A 500-turn cap ends the game as lost (`reason: 'too-long'`).
- Step-by-step resolution:
  - Round 0 is firing only; then one step per round for every guest with steps left, furthest-along first, ties in spawn order.
  - After each round's movement, every tower with shots left fires once at the furthest in-range guest.
  - Firing-only rounds continue while shots and targets remain.
- Effects:
  - Stall: the hit turn's remaining steps are cancelled, then `ceil(d)` turns with no steps, then `ceil(0.5·d)` turns of stall immunity. A stall is never refreshed while the guest is stalled or immune.
  - Slow applies to the next `ceil(d)` budgets.
  - `immuneTo` skips the effect; damage still applies.
- Quotes: 0.35 chance at spawn, 0.25 per turn for walking guests, at most 2 per guest, at most 1 per guests' turn. The RNG is injectable.
- Player-facing currency is caps 🧢, lives are kegs 🍺, the target is the beer bar 🍻. Internal field names stay.
- Branch `turn-based`; every task ends with `cd tower-defence && npm test` green and a commit; no push.

## Review Focus

1. **A fast guest crosses a tower's range while the tower has shots left.** It gets shot. (Task 1 test.)
2. **Repeated distract or lure on one guest.** No permanent pin: the guest keeps progressing over 50 turns even when `fireRate × duration ≥ 1`. (Task 1 test.)
3. **The game always ends.** A speed-0 guest is clamped, and the 500-turn cap applies; a bot that only ends turns finishes every starter and generated level. (Tasks 1 and 3 tests.)
4. **Wrong-time input.** A 4th action, actions during the guests' turn, actions after win or lose, and ringing the bell twice are all refused with a reason, without changing caps or towers. (Task 1 test; Task 4 also disables the UI.)
5. **Old data still works.** `fallback-data.json`, generated levels and legacy DB rows load and play in the new engine unchanged (values reinterpreted per turn). (Tasks 2 and 3 tests.)

---

### Task 1: Turn engine

**Files:**
- Rewrite: `tower-defence/game/logic/state.js` (keep `sellRefund` export)
- Rewrite: `tower-defence/test/state.test.js`
- Modify if useful: `tower-defence/game/logic/waves.js` (turn-based spawn schedule: `buildSpawnTurns(wave): Array<{ turn: number, enemyId }>` with `turn = floor(delayS + k·intervalS)`), `tower-defence/test/logic-basics.test.js`

**Interfaces:**
- Consumes: `weaponStats`, `upgradeCost` (`stats.js`), level/catalog shapes (unchanged).
- Produces `class GameState`:
  - `constructor(level, { weapons, enemies }, { rng = Math.random } = {})`
  - **Fields:**
    - `corks`, `wine`
    - `turn` (starts at 1)
    - `phase`: `'player' | 'won' | 'lost'` (the guests' turn runs inside `endTurn`)
    - `endReason`: `'kegs' | 'too-long' | null`
    - `actionsLeft` (3 at the start of each player turn)
    - `waveIndex` (waves started so far), `totalWaves`
    - `nextWaveIn` (0 means a wave starts in the coming guests' turn; `null` while a wave is running or when no waves are left)
    - `towers: [{ id, x, y, weaponId, tier, spent, shotCredit }]`
    - `enemies: [{ id, enemyId, hp, maxHp, pathIndex, credit, stalledTurns, stallImmuneTurns, slowFactor, slowTurns, quotesLeft, spawnOrder }]`
    - `bellUsed`
  - **Player actions:**
    - `tileType(x, y)`: unchanged values.
    - `placeTower(x, y, weaponId)`, `upgradeTower(towerId)`, `sellTower(towerId)`. Each returns `{ ok, reason? }` and costs 1 action on success. Reasons: `'no-actions' | 'not-buildable' | 'not-in-level' | 'no-corks' | 'max-tier' | 'unknown' | 'game-over'`.
    - `ringBell(): { ok, reason?, events }`: free, at most once, only during the player turn. It returns `bell` and `kill`-like payout info in `events` (`{ type: 'bell', count, reward, ids }`).
  - **`endTurn(): { ok, reason?, events: Event[] }`:**
    - Pays the action bonus, resolves the guests' turn exactly as the spec's precise rules describe, then starts the next player turn (`turn += 1`, `actionsLeft = 3`) unless the game is over.
    - **Events** (ordered, each with `round`):
      - `wave-start {wave}`
      - `spawn {id, enemyId, pathIndex}`
      - `step {id, from, to}`
      - `shot {towerId, targetIds, x, y}`
      - `effect {id, kind: 'slow' | 'stall', turns}`
      - `kill {id, enemyId, reward, x, y}`
      - `leak {id, enemyId, wineDamage}`
      - `quote {id, enemyId, text}`
      - `bonus {caps}` (round −1, first)
      - `wave-cleared {wave}`, `won`, `lost {reason}`
  - `previewSteps(enemyInstance): number`: 0 if stalled, else `floor(credit + speed·slowFactor)` (with the 0.1 speed floor).
  - `sellRefund(tower)` export is unchanged.
  - `tick` and `startNextWave` are removed.

- [ ] **Step 1: Write failing tests.** Use tiny inline levels and a stub rng. RF tags are noted.
  - **Actions** **(RF4)**:
    - A 4th action returns `'no-actions'` and caps are unchanged.
    - `endTurn` with 2 unused actions pays 20 caps and emits a `bonus` event first.
    - Actions after `won`/`lost` return `'game-over'`.
    - The bell is free, works once, and a second ring returns `'used'`.
  - **Speed:** a speed-3 guest advances 3 tiles per turn. A speed-0.6 guest's per-turn steps over 5 turns are `[0, 1, 0, 1, 1]`. A speed-0 guest is clamped to 0.1 and arrives eventually.
  - **Fire rate:**
    - A tower with fireRate 0.45 fires on turns where `floor(credit)` ≥ 1: over 4 turns the shot counts are `[0, 0, 1, 0]` (credits 0.45, 0.9, 1.35→0.35, 0.8).
    - Upgrading to a higher fireRate gives more shots from the next guests' turn.
    - A tower fires at most once per round.
    - A guest standing still in range takes all of a tower's shots in that turn.
  - **(RF1)** Path of 7 tiles, tower range 1 covering only tile 3, guest speed 6 starting at the door, tower fireRate 1. The guest is shot exactly once while passing.
  - **Stall timing:**
    - Hit in turn T: no further steps in T, 0 steps in T+1…T+ceil(d), then steps resume.
    - During the next `ceil(0.5·d)` turns, new stall hits don't apply.
    - **(RF2)** A guest under a distract tower with fireRate 1 and duration 3 still reaches the end within 50 turns.
  - **Slow:** a hit in T leaves T's budget alone and reduces T+1…T+ceil(d).
  - **Immunity:** a guest with `immuneTo: ['distract']` keeps stepping and takes damage. A non-immune neighbour gets stalled.
  - **Spawns:**
    - Group `{count: 3, intervalS: 0.5, delayS: 0}` spawns 2 guests in the wave's first guests' turn and 1 in the second.
    - A spawned guest can be shot in round 0 on the door tile and moves the same turn.
    - Tie order follows spawn order.
  - **Waves:**
    - Wave 1 starts in turn 1's guests' turn.
    - After a wave is cleared at turn T, `nextWaveIn` is 2 → 1 → the wave starts in T+2's guests' turn.
    - Win after the last wave is cleared with kegs > 0; lose when kegs ≤ 0 (`endReason 'kegs'`).
  - **(RF3)** 500-turn cap: a level whose guests can never be killed or arrive ends lost with `'too-long'`.
  - **Quotes:**
    - `rng = () => 0` gives exactly 1 quote in the spawn turn even with several quoted guests.
    - `rng = () => 0.99` gives none.
    - At most 2 per guest.
  - **Determinism:** the same rng sequence gives identical event lists.
- [ ] **Step 2: Run `cd tower-defence && npm test`.** Expected: the new state tests FAIL. Other suites that use the old API, like the generator's no-tower test, may fail too; Task 3 updates those. To keep the suite green in this task, mark them `todo` with "updated in Task 3".
- [ ] **Step 3: Implement the engine** (and `buildSpawnTurns` if used).
- [ ] **Step 4: Run `npm test`.** Expected: PASS, with only the declared todos.
- [ ] **Step 5: Commit** `feat(td): turn-based rules engine`.

### Task 2: Sensible-player bot and starter balance

**Files:**
- Create: `tower-defence/game/logic/bot.js`, `tower-defence/test/balance.test.js`
- Modify: `tower-defence/fallback-data.json` (numbers only), `tower-defence/supabase/seed.sql`, `tower-defence/supabase/upgrade-beer-party.sql` (regenerate with `npm run seed`, then `npm run upgrade-sql`)

**Interfaces:**
- Consumes: the `GameState` API (Task 1).
- Produces:
  - `export function playSensibly(state): void`: spends `state.actionsLeft` greedily during one player turn.
    - If affordable, build the level weapon with the best `damage × fireRate / cost`. Weapons with damage 0 are scored as 0.5 damage-equivalent per stall/slow second.
    - Place it on the buildable tile with the most path tiles within its range, ties broken by the smallest `(y, x)`.
    - Otherwise upgrade the tower that covers the most path tiles, if affordable.
    - Otherwise do nothing.
  - `export function runGame(level, catalog, { bot = 'sensible' | 'idle', rng }): { phase, turn, endReason }`: runs until the game ends.

- [ ] **Step 1: Write failing tests** in `balance.test.js`:
  - Both fallback levels with the `'sensible'` bot end `won` for 5 seeded rngs.
  - With `'idle'` they end `lost` with `endReason 'kegs'`. **(RF3, RF5)**
  - Each game finishes in under 300 turns.
- [ ] **Step 2: Run `npm test`.** Record which assertions fail with the current numbers.
- [ ] **Step 3: Implement `bot.js` and re-tune `fallback-data.json`.** Allowed changes: costs, hp, speed, reward, wineDamage, fireRate, damage, range, durations, startingCorks, startingWine and wave counts. Ids, names, quotes, immunities and effects stay. Keep the Café and Pizza Hut stall-capable but not pinning. Level 1 stays easier than level 2.
- [ ] **Step 4: Run `npm test`, `npm run seed` and `npm run upgrade-sql`.** Expected: PASS, and the seed reports 5 weapons, 5 enemies and 2 levels.
- [ ] **Step 5: Commit** `feat(td): bot playtest and turn-based balance`.

### Task 3: Generator on the turn engine

**Files:**
- Modify: `tower-defence/shared/generator.js` (tuning only, as needed), `tower-defence/test/generator.test.js`

**Interfaces:**
- Consumes: `GameState` (Task 1). Uses `runGame` from Task 2 if merged, otherwise a local idle loop that calls `endTurn()` until the game ends.
- Produces: the generator API is unchanged.

- [ ] **Step 1: Update the no-tower check.** It should use the turn engine: idle play (end turn immediately) on 1–2-wave generated levels across sizes, difficulties and 10 seeds must end `lost` with `'kegs'`, never `'too-long'`. Remove any `todo` markers left by Task 1. **(RF3)**
- [ ] **Step 2: Add a check over the existing RF3 grid subset.** Waves {1, 6}, all sizes and difficulties, 5 seeds: idle play ends within 500 turns. **(RF5)**
- [ ] **Step 3: Run `npm test`.** Re-tune generator constants only if these fail; keep all existing generator tests green (caps, ratios, every guest appears, determinism, `canSave`).
- [ ] **Step 4: Commit** `test(td): generator checks on the turn engine`.

### Task 4: Turn-based game screen

**Files:**
- Modify: `tower-defence/game/scenes/GameScene.js`, `tower-defence/game/ui/Hud.js`, `tower-defence/game/ui/BuildMenu.js`, `tower-defence/game/ui/TowerPanel.js`, `tower-defence/game/ui/widgets.js` (`reasonText` adds `'no-actions'` → "No actions left this turn"), `tower-defence/game/how-to.js`, `tower-defence/game/scenes/MenuScene.js` (how-to copy), `tower-defence/game/scenes/EndScene.js` (shows turns taken)
- Create (if useful): `tower-defence/game/playback.js`, a pure helper that groups events by round into timed steps. Tested in `test/playback.test.js`.

**Interfaces:**
- Consumes: the `GameState` API and events (Task 1), `makeSprite`/`icon` and the textures from the existing look.
- Produces the UI from spec Goal 7:
  - **HUD:** caps, kegs, "Wave n/total · Turn t", "Next wave in N turns" when `nextWaveIn` is set, three action dots, the 🔔 bell, **End turn ▶** (Space also ends the turn) and a ⏩ toggle.
  - **During the guests' turn:** all action input is disabled; build, upgrade, sell and the bell are refused with the "Guests are moving…" toast.
  - **Previews:** each guest shows a small "→n" badge from `previewSteps`.
  - **Playback:**
    - The events from `endTurn()` play back round by round. Guests tween tile to tile (about 120 ms per step at 1×, 3× faster with ⏩).
    - Shots, kills, leaks, effects and quotes reuse the existing effects: floats, flying caps, bubbles, bell flash, wobble and lean for stalled guests.
    - A `bonus` event floats "+N 🧢" at the caps card.
    - Guests sharing a tile are offset slightly.
  - **Removed:** the per-frame `state.tick`, the "Next wave" button, any speed or pause controls of the old loop, and timer-based cooldown visuals.
  - **Unchanged:** layout guarantees (1280×720 minimum, panels fit, `Scale.FIT`, right-click ignored).
  - **How-to text:** explains 3 actions per turn, 10 🧢 per unused action, guests moving tile by tile up to their speed, and towers firing as they pass.

- [ ] **Step 1: Write failing tests** for `playback.js` (if created):
  - Events are grouped by round, in order.
  - Step durations scale with ⏩.
  - `bonus` comes first.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify.**
  - `npm test` and `node --check` on every changed file.
  - A stub-Phaser smoke run (not committed) covers: placing 3 towers, a 4th refused, End turn, the playback finishing and re-enabling input, the bell, win and lose, and layouts 5×5/16×10/30×30.
  - If headless Chrome is available, screenshot a player turn and a guests' turn.
- [ ] **Step 4: Commit** `feat(td): turn-based game screen`.

### Task 5: Admin labels in turns

**Files:**
- Modify: `tower-defence/admin/catalog-editor.js`, `tower-defence/admin/level-editor.js`, plus any admin help text mentioning seconds

- [ ] **Step 1: Change the labels:** "Speed (tiles/turn)", "Fire rate (shots/turn)", "Effect duration (turns)", "Interval (turns)", "Delay (turns)". Also update hint and comment text that mentions seconds and the wave summary units. Values and validation stay as they are.
- [ ] **Step 2: Verify.** Run `npm test` and `node --check`, and grep `admin/` for user-visible "(s)", "seconds" and "/s" leftovers.
- [ ] **Step 3: Commit** `feat(td): admin speaks in turns`.

---

## Execution waves (parallel)

W1: Task 1, Task 5 · W2: Task 2, Task 3, Task 4 (all after Task 1 is merged) · then the final whole-branch review.

## Self-review notes

- **Spec goals covered:**
  - Round structure: Tasks 1 and 4.
  - Per-turn speed and fire rate: Task 1.
  - Effects: Task 1.
  - Automatic waves: Tasks 1 and 4.
  - Quotes: Tasks 1 and 4.
  - Win/lose: Task 1.
  - UI: Task 4.
  - Labels: Task 5.
  - Generator: Task 3.
  - Settled calls: balance bot (Task 2), stall and slow timing (Task 1), firing and spawn ties (Task 1), wave gap (Task 1), safety cap (Task 1), old controls removed (Task 4), no time-based records (nothing to do).
- **Builder's calls fixed here:**
  - Bot heuristic, step tween of about 120 ms with ⏩ at 3×.
  - Tower placement score: path tiles in range.
  - Damage-0 weapons scored as 0.5 per stall second.
