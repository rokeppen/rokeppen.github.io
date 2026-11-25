# Beer party refresh: design

Follow-up to `2026-11-25-friday-drinks-tower-defence-design.md`. The game and admin editor from that design are built (branch `tower-defence`); this design changes the theme, the look, and adds level tooling.

## Intent

The author played the built game and found it works but **looks old**. They also want the party to be about **beer, not wine**, the ability to use **custom images** instead of only emoji, the ability to **randomly generate levels** in the admin editor, and to **link specific guests (enemies) to levels**. The demo judges score polish, fun, features and Nexios references, so the refresh should make the game look current and add visible editor features.

## Goals

1. **New look: "style C, flat 2D".** Pastel palette and soft chunky depth from the approved mockup, on the existing straight-on 2D grid (no isometric tilt):
   - Cream floor with soft grid tiles; coral carpet path with an inset bottom edge; furniture on raised slate-blue blocks.
   - Everything standing on the floor (towers, guests, beer bar, furniture) has a solid bottom edge plus a soft drop shadow.
   - Towers: white rounded blocks with the weapon icon and green tier dots. Guests: white rounded pieces with a slim HP bar above.
   - HUD: separate white rounded stat cards (caps, kegs, wave) and chunky buttons (Next wave = dark navy, Victory Bell = gold, mute = white).
   - Side panel: build list as white cards (unaffordable faded, selected outlined green) and a selected-tower card with Upgrade / Sell.
   - Pastel green range circle while placing; "+N 🧢" float on kills.
   - Small motion (controller proposal, not objected to): guests bob while walking, towers squash slightly when firing, caps fly to the HUD counter.
   - The welcome page, level menu, how-to overlay and end screen adopt the same look. The admin pages get the same palette and card style (lighter touch).
2. **Beer theme.**
   - Guests head for the **beer bar 🍻** (was the wine table).
   - Lives are **kegs 🍺** (was wine). Currency is **bottle caps 🧢** (was wine corks).
   - Game title stays "Friday Afternoon Drinks" (controller call: beer is the drink; the user didn't ask for a rename).
   - All player-facing text, toasts, how-to, descriptions and quotes updated to match.
3. **Café tower replaces Wine Tasting.** "Café" in the Belgian sense: a little pub corner guests can't resist. Keeps the **distract** effect. New id `cafe`; the `wine-tasting` weapon is removed from bundled data and the DB (migration).
4. **Wine Snob guest.** New enemy `wine-snob`: grumbles that the beer party isn't fun (speech bubbles, e.g. "This beer party isn't fun." / "Is there no Pinot?"). Mechanic: **immune to the Café's distract effect**. Carries the wine-tasting Nexios reference forward.
5. **Guest abilities and quotes as data (editable in the guest editor):**
   - `quotes: string[]`: optional lines shown in a speech bubble above the guest (at spawn with some probability and/or occasionally while walking; not spammy, at most one bubble per guest at a time, max a few on screen).
   - `immuneTo: string[]`: list of effects (`slow`, `distract`, `lure`) that don't apply to this guest. A shot still deals its damage.
   - Starter content gets quotes for every guest (good-natured).
6. **Guest list per level.** New level field `enemyIds` (like `weaponIds`). The wave editor's guest dropdown offers only the level's guests; the editor warns when removing a guest that waves still use (as it does for weapons). The game ignores wave groups whose guest isn't in the level's list (validateLevel drops them with an error, same as unknown enemies).
7. **Random level generation in the admin editor.** A "🎲 Generate" panel in the level editor (approved mockup) with:
   - Size: Small 12×8 / Medium 16×10 / Large 20×12.
   - Difficulty: Chill / Party / Chaos (scales guest count, spawn interval, guest-mix toughness and starting caps/kegs).
   - Path: straight ↔ twisty slider.
   - Number of waves.
   - The level's guest list and weapon list (chips).
   - **Generate** fills the current draft: path from an entry tile on one edge to the beer bar on another, scattered furniture (blocked tiles, never on or sealing the path), and escalating waves using only the listed guests (tougher guests appear later). **Re-roll** = same settings, new seed. The result is a normal unsaved level: tweak, Save, Play.
   - Same settings + same seed → same level (deterministic).
8. **Custom images (approach A: Supabase Storage).**
   - A weapon's or guest's `sprite` is either an emoji (as today) or an image URL. The beer bar may also have a custom image (see Data model).
   - The admin uploads PNG/JPG/SVG/WebP in the weapon and guest editors (live preview), or clears it back to an emoji.
   - Images are stored in a public-read Supabase Storage bucket; only admins can upload, replace or delete.
   - The game loads images at boot. If any image fails (network, CORS, deleted), that weapon/guest falls back to its emoji (each item keeps an emoji fallback); the game never blocks on images.

## Non-goals

- Isometric or 3D rendering. Players generating random levels in the game. Save games / leaderboard (still later).
- Renaming internal field or DB column names (`corks`, `startingCorks`, `wine`, `startingWine`, `wineDamage`, `wine_damage`, …). Controller call: only player- and admin-facing text changes; the internal names stay to avoid a risky migration. A short comment in theme/data code maps them (corks = caps, wine = kegs).
- Replacing Phaser or moving the board to HTML/CSS.

## Anti-goals

- The demo must still start if Supabase, Storage or any image fails (fallback data, emoji fallback).
- No secret keys in the repo; anonymous visitors can't write to tables or Storage.
- Readability: path, furniture, towers and guests must stay easy to tell apart at a glance in the pastel palette (check contrast, as before).
- Quotes and the Wine Snob stay good-natured; no real colleague names.

## Constraints

- Same stack and rules as the first design: GitHub Pages from `main`, no build step, native ES modules, Phaser 3.90.0 (vendored fallback), supabase-js 2.57.4, `node --test` for pure modules, DOM APIs/textContent only in admin.
- The pure simulation (`game/logic/`) stays framework-free; new mechanics (immunity) go there with tests.
- Existing Supabase project: changes ship as an idempotent **migration SQL** the author pastes (plus updated `schema.sql`/`seed.sql` for fresh setups). The author has run `schema.sql`/`seed.sql` already (assume yes; migration must work either way).
- Work continues on branch `tower-defence`; nothing is pushed or merged without the author's say-so.

## Approaches

**Rendering the new look** (controller call, stated to the author): keep Phaser; draw the rounded tiles, shadows and cards as shapes, generated once into reusable textures, so it looks like the mockup and stays fast. Rebuilding the board in HTML/CSS would redo input and animation for no visible gain.

**Generator** (controller call): a separate pure, tested module (`shared/generator.js`) with a seeded RNG, called by the editor.

**Where custom images live** (author's choice among three):
- **A. Supabase Storage upload. Chosen.** Admin manages everything in the browser, which is what the editor shows off. Costs one more SQL setup step; bundled fallback uses emoji.
- B. Image files in the repo, picked from a dropdown. Most demo-robust but every image needs a commit; no browser upload.
- C. Paste any image URL. Least work, least robust (links break, CORS), least polished.

## Data model changes

- `enemies`: add `quotes jsonb default '[]'` (array of strings), `immune_to text[] default '{}'`. App shape: `quotes: string[]`, `immuneTo: string[]`.
- `levels`: add `enemy_ids text[] default '{}'`. App shape: `enemyIds: string[]`. Migration fills it for existing rows from the enemy ids used in their waves.
- `sprite` columns stay `text`: an emoji, or an `https://` URL into the Storage bucket. Weapons and enemies get a new column `fallback_sprite text` (app: `fallbackSprite`): the emoji shown when `sprite` is a URL that fails to load. Default 👤 for guests, ❔ for weapons.
- Beer bar image: a level-independent setting is not modelled today. Controller call: add an optional `bar_sprite` (app `barSprite`) on **levels** (default 🍻), editable in the level editor settings, same emoji-or-URL rule. Generated levels get the default.
- Storage: bucket `sprites`, public read; `insert/update/delete` on `storage.objects` for that bucket only when `is_admin()`; limit file size (e.g. 1 MB) and types (png, jpeg, svg+xml, webp) via bucket settings.
- `mapping.js`, `seed-sql.js`, `validateLevel`, `validateEnemy`/`validateWeapon`, `exportJson` and `fallback-data.json` all updated for the new fields; fallback data adds `cafe`, `wine-snob`, quotes, `enemyIds`, and removes `wine-tasting`.
- Migration SQL (`supabase/migrations/2026-11-25-beer-party.sql`, idempotent): add columns, backfill `enemy_ids`, insert/replace `cafe` and `wine-snob`, remove `wine-tasting` from `weapons` and from every level's `weapon_ids` (adding `cafe` where `wine-tasting` was), create bucket + storage policies, grants as in schema.sql.

## Gameplay changes

- `GameState` respects `immuneTo`: an effect listed there is not applied to that guest (damage still applies). Tests cover each effect.
- `GameState` emits a `quote` event (`{id, text}`) when a guest should speak (randomness via an injectable RNG so tests are deterministic); the scene renders and expires the bubble.
- Wave groups referencing a guest not in `enemyIds` are dropped by `validateLevel` (error string), consistent with unknown enemies.

## Editor changes

- Level editor: guest list chips (like weapons), wave-editor dropdown limited to them, Generate panel (Goal 7), bar image setting.
- Guest editor: quotes list (add/remove lines), immune-to checkboxes, image upload / clear with preview, fallback emoji field.
- Weapon editor: image upload / clear with preview, fallback emoji field.
- Upload flow: file → `supabase.storage.from('sprites').upload(<uuid>.<ext>)` → public URL saved into `sprite`. Replacing an image deletes the old object (best effort). Errors shown inline; never stuck buttons.

## Build order (suggested)

1. Data model + migration + fallback/seed content (beer renames in data, Café, Wine Snob, quotes, enemyIds).
2. Simulation: immunity + quote events.
3. Generator (pure, tested).
4. Game restyle (theme, board, HUD, side panel, menus, end screen, welcome page) + beer text + quote bubbles + motion.
5. Image loading in the game with emoji fallback.
6. Editor: guest list, Generate panel, quotes/immunity fields, image upload, bar image.
7. Admin restyle (light), polish, readability check.

## Settled after builder review (controller calls)

1. **Immunity:** each effect is checked on its own. If the guest is immune to an effect, that effect is skipped entirely (no slow, no stall, and no stall-immunity window started); the shot's damage still applies. Other effects are unaffected. The Wine Snob is `immuneTo: ['distract']` only (Pizza Hut's lure still works on it).
2. **Sprites:** `sprite` is a URL when it matches `/^https?:\/\//`, otherwise it's an emoji. For emoji sprites, `fallbackSprite` equals the sprite. At boot the game preloads every image URL in the loaded data (weapons, guests, levels' `barSprite`); while loading or after a failure the item shows its `fallbackSprite`. All places that draw a sprite (board, build list, tower panel, HUD wave preview, quote bubbles, menus) go through one helper. `barSprite` replaces the bar's icon only; the entry door stays.
3. **Seed:** internal; shown read-only in the Generate panel ("Party #4821") and not stored on the level.
4. **Generator inputs:** guest toughness = `hp × speed × wineDamage` (no new field). The generator needs at least one weapon with damage > 0 in the level's weapon list and at least one guest; otherwise Generate is disabled with a message. It does not prove winnability; difficulty scales guest count, spawn interval, toughness mix and starting caps/kegs.
5. **Wine → beer text:** bundled `fallback-data.json`, `seed.sql` and all UI strings are rewritten. The migration **upserts the starter catalog and starter levels by id** (so the author's DB gets the new names, descriptions, quotes and stats). This overwrites admin edits to those starter rows only; admin-created rows are untouched except for the `wine-tasting` → `cafe` swap.
6. **Existing levels:** only the `wine-tasting` → `cafe` swap and the `enemy_ids` backfill; the Wine Snob is not added to existing user-made levels. Starter levels (upserted) may include it.
7. **Uploads:** the editor checks type and size (≤ 1 MB) before uploading and shows an inline error; the bucket enforces the same limits. Replacing an image deletes the old object (best effort); deleting a weapon/guest does not clean up its image (orphans accepted).

## Left to the builder

- Exact pastel colour values (within the approved mockup), shadow sizes, animation timings.
- Generator internals (path algorithm, furniture density, difficulty formulas) as long as output always passes `validateLevel` and the editor's `canSave`, is deterministic per seed, and respects the chosen settings.
- Quote frequency tuning, starter quotes text, Café and Wine Snob stats.
- Upload filename scheme and max size within the stated limits.
