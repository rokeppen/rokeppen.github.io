# Turn-based play: design

Follow-up to `2026-11-25-beer-party-refresh-design.md` (merged and live on `main`). This changes how the game is played; look, data, editor and Supabase stay.

## Intent

A **new requirement** for the assignment: the game becomes turn-based. It **replaces** real-time play (no mode switch). Same map, towers, guests, waves and art.

The author's rules, verbatim:
- In your turn you take up to 3 actions: build, upgrade or sell. Each action you don't use pays 10 gold.
- In the enemy turn every enemy moves as many tiles as its speed allows, so fast enemies stay fast.
- Every tower fires as many times per turn as its fire rate allows, and upgrades that raise fire rate add shots.

"Gold" is the game's currency: **bottle caps 🧢** (internal `corks`).

## Goals

1. **Round structure.** Each round has a player turn, then a guests' turn.
   - **Player turn:** up to **3 actions** (place, upgrade, sell). An "Actions 2/3" counter is shown. **End turn** pays **10 🧢 per unused action**. The Victory Bell is a **free** extra (still once per level), not an action.
   - **Guests' turn:**
     - New guests enter at the door when their spawn turn arrives.
     - Guests move **one tile at a time**. After each step, towers with shots left fire at guests in range ("step by step", author's choice A).
     - Guests reaching the bar drain kegs.
     - The phase plays as an animation of about 1–2 s, with a ⏩ speed-up toggle.
2. **Speed and fire rate become per-turn amounts.** One second in the existing data equals one turn (data and editor values keep their meaning, relabelled). Fractions accumulate across turns: speed 0.6 gives 3 steps every 5 turns, and fire rate 0.45 gives a shot about every other turn. Raising fire rate via an upgrade adds shots.
3. **Effects in turns.** Slow reduces the steps a guest earns. Distract and lure (stall) make a guest take no steps for the duration. Stall immunity after a stall, and guest immunities (`immuneTo`, e.g. the Wine Snob ignores the Café), carry over.
4. **Waves arrive by themselves.** No "Next wave" button.
   - The first wave starts in the guests' turn after the player's first turn.
   - Each next wave starts **2 turns** after the previous wave is cleared. The HUD shows "Next wave in N turns".
   - Spawn timing within a wave (`delayS`, `intervalS`) is read in turns.
5. **Quotes** pop up during the guests' turn (same per-guest limits as today).
6. **Win** when all waves are cleared with kegs left. **Lose** when kegs reach 0.
7. **UI:** HUD shows caps, kegs, "Wave n/total · Turn t", the action dots, the bell and **End turn ▶** (Space also ends the turn). A ⏩ toggle. Each guest shows "→n", the steps it will take next turn. Input for actions is disabled during the guests' turn.
8. **Editor and admin labels** switch from seconds to turns: Speed (tiles/turn), Fire rate (shots/turn), Effect duration (turns), Interval (turns), Delay (turns). Data values are unchanged.
9. **Generator** keeps producing valid levels. Its tests and "no towers → lose" check run against the new engine; tuning may change.

## Non-goals

- A real-time mode, or switching between modes.
- Data model or DB changes. No migration.
- Undoing an action within a turn (selling is the way back).
- Multiplayer or hot-seat.

## Anti-goals

- Rules that differ from the author's wording (e.g. towers firing only before or after movement, or continuous movement).
- A fast guest walking through a tower's range untouched while that tower still had shots.
- Permanent pins: a guest stalled forever by repeated distract/lure.
- Long unskippable animations: the guests' turn must stay snappy (⏩ helps).

## Constraints

Same as before: no build step, native ES modules, Phaser 3.90, pure `game/logic/` tested with `node --test`, DOM-only admin, publishable key only, demo works with Supabase down. Work on a new branch off `main`; nothing pushed without the author's say-so.

## Approaches

- **A. New turn-based rules engine (chosen by the author).** Replace the real-time simulation with a turn engine. The guests' turn resolves step by step into an ordered event list that the scene plays back. Rules exactly as written, easy to test per turn. Cost: core rules and their tests are rewritten.
- B. Wrap the real-time simulation, running 1 s per guests' turn and replaying it. Much cheaper, but movement stays continuous and towers fire on timers, not "after each step". It looks turn-based without following the rules. Rejected.
- C. Hybrid: whole-tile movement with timer-based towers. Most of A's work without exact rules. Dropped.

## Turn engine rules (precise)

Notation: one **round** = player turn + guests' turn. `turn` counts rounds from 1.

**Player turn**
- `actionsLeft = 3` at the start.
- `placeTower`, `upgradeTower` and `sellTower` each cost 1 action; at 0 they return `reason: 'no-actions'`.
- Existing reasons stay (`not-buildable`, `no-corks`, `max-tier`, …).
- `ringBell` is free.
- `endTurn()` adds `10 × actionsLeft` caps and runs the guests' turn.

**Guests' turn**, in this order:
1. **Wave progress.** If no wave is running and the next wave is due, it starts and emits `wave-start`. A wave is due on turn 1, and then 2 turns after the previous one is cleared.
2. **Spawns.** Each group schedules guest k at time `delayS + k × intervalS`, counted in turns from the wave start. A guest spawns in the guests' turn whose index (0-based within the wave) equals `floor(time)`. Spawned guests appear on the door tile and emit `spawn`.
3. **Step budget.** For each guest:
   - If stalled this turn, its budget is 0 and its stall counter goes down.
   - Otherwise `credit += speed × slowFactor` and `steps = floor(credit)`, with `credit -= steps`.
   - Slow lasts `ceil(effectDuration)` guests' turns.
4. **Shot budget.** For each tower, `shotCredit += fireRate(tier)`, `shots = floor(shotCredit)` and `shotCredit -= shots`.
5. **Resolution rounds.**
   - Round 0 is firing only. Then step round 1, 2, … until no guest has steps left.
   - In each step round, every guest with steps left moves one tile along the path (furthest-along guests first) and emits `step`. A guest reaching the end tile drains `wineDamage` (emits `leak`) and is removed.
   - After the movement of every round, including round 0, each tower with shots left and a target in range fires one shot at the in-range guest furthest along. This applies damage and effects with the existing semantics: lure hits all in range, splash hits around the target, and immunity skips the effect, not the damage. It emits `shot`, plus `kill` with reward caps when a guest dies.
   - After the last step round, extra firing-only rounds continue while any tower has shots left and a target in range. Unused shots are lost; the leftover fraction stays in `shotCredit`.
6. **Effects.**
   - **Distract/lure** sets the guest stalled for `ceil(effectDuration)` guests' turns, starting now: any steps it has left this turn are cancelled.
   - When a stall ends, the guest is immune to stalls for `ceil(0.5 × effectDuration)` turns. A stall is not refreshed while already stalled or immune, so there are no permanent pins.
   - **Slow** sets `slowFactor` for `ceil(effectDuration)` turns (refresh, not stack).
7. **Quotes.**
   - At spawn with probability 0.35. Each turn a walking (not stalled) guest with budget left speaks with probability 0.25.
   - At most 2 quotes per guest and at most 1 new quote per guests' turn.
   - Injected RNG.
8. **End of turn.** Lose if kegs ≤ 0. Win if the last wave was spawned and no guests remain. Otherwise, if the current wave is fully spawned and cleared, emit `wave-cleared`, then back to the player turn.

**Events:** every guests' turn produces an ordered list of events, `{ type, round, … }` with types `wave-start`, `spawn`, `step`, `shot`, `kill`, `leak`, `effect`, `quote`, `wave-cleared`, `won`, `lost`. Each carries the ids and positions the scene needs. The scene animates them grouped by `round`. With ⏩ it plays faster, and when the speed-up is held it can skip straight to the final state.

**Preview "→n":** the steps the guest would take next turn if nothing changes: 0 if stalled, else `floor(credit + speed × slowFactor)`.

## Settled by the controller (author can override)

- 1 s in data = 1 turn. Durations are rounded up with `ceil`; spawn times are floored.
- Wave gap is 2 turns. The first wave comes in the first guests' turn, so the player gets one build turn first.
- Bonus is paid only for unused actions, including when the player ends the turn early.
- Sell refund stays 50 % of spent.
- Quote probabilities as above.
- Balance numbers in `fallback-data.json` may be re-tuned for turns. Constraint: the starter levels stay winnable with sensible play, and Wine Tasting-style permanent pins are impossible (tested).

## Settled after builder review (controller calls)

1. **Balance check.** A scripted "sensible player" bot lives in tests: each turn it spends its actions greedily, building the best damage-per-cap tower on the buildable tile closest to the path's middle, otherwise upgrading the most-used tower. Both starter levels must be won by this bot, and lost by a bot that only ends turns. Balance numbers in `fallback-data.json` are re-tuned until that holds.
2. **Stall timing.** A guest hit in guests' turn T loses its remaining steps in T, then takes no steps in the next `ceil(d)` guests' turns. After that it is immune to stalls for the next `ceil(0.5 × d)` guests' turns. The hit turn doesn't count toward either.
3. **Slow timing.** A slow hit in turn T affects the step budgets of the next `ceil(d)` guests' turns (T+1…T+ceil(d)). The hit turn's budget is already fixed.
4. **Firing.**
   - A tower fires at most once per resolution round, so a guest standing in range can take all of a tower's shots across the rounds.
   - Guests spawned this turn are on the door tile in round 0, can be shot there, and get a step budget this turn.
5. **Spawning.** Several guests may share a tile, including the door. Move order is furthest-along first, with ties broken by spawn order. The scene offsets guests that share a tile slightly so they stay visible.
6. **Wave gap.** A wave cleared at the end of guests' turn T is followed by "Next wave in 2 turns" (T+1 shows 1), and the next wave starts in guests' turn T+2. The player gets 2 build turns in between.
7. **No-tower bot and safety.** The "no towers → lose" check ends each turn immediately. Guests with speed 0 in data are clamped to a minimum of 0.1 tiles per turn in the engine, and a 500-turn cap ends the game as lost (`reason: 'too-long'`), so a game always ends.
8. **Old controls.** The real-time pieces are removed: the "Next wave" button, the tick and time cap, timer-based cooldown visuals, and any 1×/2× or pause controls. The only speed control is the new ⏩ for the guests' turn animation.
9. **No time-based records.** Nothing persisted depends on elapsed seconds. Best-wave progress stays as is.

## Left to the builder

- Engine internals and module split (`game/logic/`), as long as the rules above hold and are tested turn by turn.
- Animation timings (target about 1–2 s per guests' turn, ⏩ about 3× faster), how guests visibly "step" tile to tile, bubble timing.
- Exact HUD layout within the existing style.
- Generator tuning constants.
