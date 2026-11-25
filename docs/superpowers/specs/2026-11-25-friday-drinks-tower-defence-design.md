# Friday Afternoon Drinks: tower defence design

## Intent

A browser tower defence game for a one-day Nexios bootcamp assignment ("Defend the Codebase" brief, custom theme). The game must be live on GitHub Pages by 15:45 for a 16:00 demo where a judge plays live and the audience votes. Prizes: **most features** (counted live), **most fun** (audience vote), **most polished**, **best Nexios references** (references that are part of the gameplay score higher than decoration).

The author also wants **an admin level editor** as a showcase feature: levels, weapons, enemies and waves are data in Supabase, editable by an admin through a web UI, not hard-coded.

## Theme

**Friday Afternoon Drinks.** The Nexios office drinks are on. Uninvited guests (sales reps, recruiters, "quick question" colleagues, facilities guy, ...) crash the party and walk the path toward the **wine table**. Each guest who reaches it drinks some wine; when the wine runs out, the party is over (game over).

- **Currency:** wine corks 🍾 (earned by stopping guests, spent on placing and upgrading weapons).
- **Lives:** bottles of wine at the wine table.
- **Nexios references (≥3, woven into mechanics):**
  1. **Wine tasting** tower: guests in range get distracted and wander/stall briefly (a "distract" effect).
  2. **Pizza Hut delivery**: a lure: guests in range **stay on the path** but stop to grab a slice for a moment (stall), with a visual pull/lean toward the pizza, then continue. No off-path movement. *(Builder's call, to keep one movement system.)*
  3. **Nexios victory bell**: an ability (not a placed tower), usable once per level, that sends all guests on screen home (clears them; gives their cork reward).
  4. Optional / if time: a good-natured colleague cameo (only with that colleague's consent).

## Goals

- Meet all required brief features: waves following a path, placeable towers, losing condition, themed currency spent on towers **and upgrades**.
- A playable game page with menu (level select), HUD (corks, wine, wave), wave start button, win/lose screens, sound.
- An admin editor page where an admin can:
  1. Create/rename/delete a level and choose grid dimensions (cols × rows).
  2. Pick a start tile and end tile and lay out the path by clicking tiles.
  3. Mark tiles as non-buildable.
  4. Select which weapons are available in this level.
  5. Configure waves (count and content), starting corks and starting wine.
  6. Manage the **weapon catalog** (create/edit, including upgrade tiers).
  7. Manage the **enemy catalog** (create/edit).
- Data read from Supabase, with a bundled fallback copy so the demo survives Supabase/network problems.
- A `REGRET.md` regret log at the repo root (required deliverable): one line per "it worked and then it broke", with what and why.

## Non-goals (for now)

- Save games / player progress. (Wanted later; not for the demo.)
- A global leaderboard. (Wanted later; schema may be added after the core game works.)
- Players creating levels. Only admins edit.
- Mobile-first play. It should not break on a laptop browser; touch support is a bonus.

## Anti-goals

- Anything that makes the live demo fragile: the game must still start if Supabase is down or an edit is half-finished.
- Secrets or client-sensitive data in the public repo. Only the Supabase **publishable** key goes in the code; never the service-role/secret key.
- Unreadable visuals: towers, enemies, path and blocked tiles must be easy to tell apart at a glance.
- Jokes at a colleague's expense or using a real colleague without asking.

## Constraints

- Static hosting on GitHub Pages, deployed straight from `main`, **no build step**.
- Existing repo layout: root `index.html` is a project overview; the game lives in `tower-defence/` (welcome page exists; `tower-defence/supabase.js` exports a configured client, supabase-js 2.57.4 from jsDelivr ESM).
- Supabase project already exists and is reachable with the publishable key.
- The author has said to **ignore the time constraint**: plan the full scope, including the editor, properly. Still ship in working increments, because `main` deploys straight to the live site.
- Builder: the author working with Claude (AI agents). Independent parts (e.g. editor grid UI vs. game) may be built in parallel once data shapes are fixed.
- **Supabase changes are manual, by the author:** the builder only has the publishable key, so it cannot run SQL or manage users. The builder delivers `schema.sql` (+ seed data) and clear instructions; the author pastes it into the SQL editor, creates the admin user, adds them to `admins`, and disables signups. Assume an **empty** project (no existing tables). Schedule this handoff early so login/saving can be tested end to end.

## Approaches

Considered:

- **A. Phaser 3 (CDN) for the game, plain DOM for the editor, no build step.** Phaser provides loop, sprites, tweens, particles, sound, scenes. The editor is form/grid UI that DOM handles better than a game engine. **Chosen** by the author: most polish and live-working features per hour, deployment unchanged.
- B. Plain canvas + vanilla JS for everything. Full control, but loop/animation/sound/menus would be hand-built, eating feature and polish time.
- C. Vite + npm + TypeScript with a GitHub Action deploy. Nicer code structure, but changes the deployment and adds infrastructure for little visible payoff on a deadline.

## Architecture

```
tower-defence/
  index.html          welcome page → "Play" (level select) and an "Admin" link
  play.html (or game inside index)  Phaser game
  admin/index.html    editor (login-gated)
  supabase.js         shared client (exists)
  data.js             shared data layer: loadCatalog(), loadLevels(), save*()
  fallback-data.json  bundled copy of levels/weapons/enemies
  game/               Phaser scenes and game logic (ES modules)
  admin/              editor scripts and styles
  assets/             sprites, sounds
```

- All JS as native ES modules loaded directly by the browser; Phaser loaded from a pinned CDN URL.
- **Data layer (`data.js`)** is the only code that talks to Supabase. The game calls it to get levels + catalogs; on any error or timeout (~3 s) it falls back to `fallback-data.json` and the game says nothing alarming to the player (log to console).
- The game must not depend on *where* data came from: same shapes from DB and from the fallback file.
- Refreshing the fallback: the editor offers an **"Export JSON"** button that downloads the current DB content in fallback format; the author commits it as `fallback-data.json`.

## Data model (Supabase)

Proposed tables (builder may adjust column details, not the concepts):

- `weapons`: `id`, `name`, `description`, `sprite` (asset key or emoji), `cost`, `range` (tiles), `damage`, `fire_rate` (shots/s), `effect` (`none` | `slow` | `distract` | `lure` | `splash`), `effect_strength`, `effect_duration`, `upgrades` (jsonb: ordered list of tiers, each `{cost, damage?, range?, fire_rate?, effect_strength?}`).
- `enemies`: `id`, `name`, `description`, `sprite`, `hp`, `speed` (tiles/s), `reward` (corks), `wine_damage` (wine drunk on reaching the table).
- `levels`: `id`, `name`, `sort_order`, `published` (bool), `cols`, `rows`, `start` `{x,y}`, `end` `{x,y}`, `path` (jsonb ordered list of `{x,y}` from start to end, orthogonally adjacent), `blocked` (jsonb list of `{x,y}`), `weapon_ids` (array), `starting_corks`, `starting_wine`, `waves` (jsonb: list of waves; each wave a list of groups `{enemy_id, count, interval_s, delay_s}`).
- `admins`: `user_id` (references `auth.users`). Membership is what makes someone an admin; rows are added by hand in the Supabase dashboard.

**Row Level Security** on every table:
- `weapons`, `enemies`, `levels`: `select` for everyone (anon); `insert/update/delete` only when `auth.uid()` is in `admins`. The game only lists `published` levels; the editor sees all.
- `admins`: readable only by the user themselves (so the editor can check "am I admin?"); no client writes.

Schema is delivered as a SQL file in the repo (e.g. `tower-defence/supabase/schema.sql`) to paste into the Supabase SQL editor, including seed rows for the theme's starter weapons, enemies and one or two levels.

## Admin access

- Supabase Auth, **email + password** login on the admin page (magic links depend on email deliverability and redirect config; password is the more reliable demo choice). Signup disabled in the Supabase dashboard; the admin user is created by hand and added to `admins`.
- The editor page shows a login form when signed out, and a "not an admin" message for signed-in non-admins. Security is enforced by RLS, not by hiding UI.

## Gameplay rules

- Tile grid from the level; path tiles are walkable and non-buildable; blocked tiles are non-buildable; all other tiles are buildable, one weapon per tile.
- Enemies spawn at `start` and follow `path` tile centres to `end`; on reaching `end` they subtract `wine_damage` from wine and disappear.
- Weapons auto-target an enemy in range (default: the one furthest along the path) and apply damage/effect per `fire_rate`.
- Kill → `reward` corks. Player clicks a placed weapon to upgrade (next tier from `upgrades`) or sell (refund, e.g. 50% of spent).
- Waves start by player pressing "Next wave" (with optional auto-start timer). Win when all waves are cleared with wine > 0; lose when wine ≤ 0.
- Victory bell: one use per level, available from wave 1.

## Art and feel

- **One style: flat 2D, warm "office party" palette** (wood/office floor tones for the map, a clearly contrasting path, bold-coloured guests). Readability first.
- Placeholder sprites may be emoji or simple shapes so data-driven entities work before art exists; the `sprite` field is either an asset key or an emoji.
- Sound: a few short effects (hit, cork pop on reward, bell, game over) and optional background music, with a mute toggle. Library choice is the builder's (Phaser's built-in audio is fine).

## Editor UX (sketch)

```
┌ Level: "Merge Conflict Monday" ───────── 16 × 10 ┐
│ [Path] [Blocked] [Erase]                          │
│ S ■ ■ ■ · · · · · · · · · · · ·    Weapons:       │
│ · · · ■ · · ✕ ✕ · · · · · · · ·    ☑ Wine tasting │
│ · · · ■ ■ ■ ■ ■ ■ ■ · · · · · ·    ☑ Coffee mach. │
│ · · · · · · · · · ■ · · · · · ·    ☐ Pizza Hut    │
│ · · · · · · · · · ■ ■ ■ ■ ■ ■ E                   │
│ Waves: 1) 10 recruiters  2) 6 sales + 2 q's [+]   │
└───────────────────────────────────────────────────┘
```

- Path drawing: click start, then click adjacent tiles to extend; clicking the last tile again removes it. Save is refused (with a message) if the path is not a continuous orthogonal chain from start to end.
- Separate tabs/sections for Levels, Weapons, Enemies.
- A "Play this level" button that opens the game on that level (including unpublished ones, for testing).

## Build order

1. Game playable on a **hard-coded/fallback** level: path, enemies, one weapon, corks, wine, waves, win/lose.
2. More weapons incl. the Nexios mechanics (wine tasting, Pizza Hut lure, victory bell), upgrades, sound, menus. Deploy.
3. Supabase schema + data layer with fallback; game reads from DB.
4. Admin editor: login, level editor (grid, path, blocked, weapons, waves), then weapon/enemy catalog editors.
5. Polish. Later (post-demo): leaderboard, save games.

Commit and deploy after each step so a working version is always live.

## Left to the builder

- Phaser version (pin an exact version from CDN), scene structure, file names inside `game/` and `admin/`.
- Exact numbers for balance, stats of starter weapons/enemies, sell refund %.
- Visual details within the chosen style; sprite sources.
- Exact schema column types and SQL, within the model above.
- Handling half-finished/invalid data: skip invalid levels in the game (and fall back if nothing valid loads).
- UI language: English.
