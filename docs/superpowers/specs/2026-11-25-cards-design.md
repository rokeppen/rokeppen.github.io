# Card play: design

Follow-up to `2026-11-25-turn-based-design.md` (merged on `main`). This changes only the player's turn. The guests' turn, waves, map, data, editor and Supabase stay as they are.

## Intent

A client requirement: replace the free choice of build, upgrade and sell with a hand of playing cards. Each card offers one action. The author wants the client's rules met cleanly and simply, nothing more.

The client's rules, as given:
- Each card has one action: build A, upgrade B, ring the bell, …
- The caps count doesn't matter for card actions, so cards are free.
- You draw a new card each turn. Cards you didn't play stay in your hand.

## Goals

1. **Cards.** There are four kinds:
   - **Build [weapon]:** pick a buildable tile and place a tier-0 tower of that weapon.
   - **Upgrade [weapon]:** pick one of your towers of that weapon below max tier, and it goes up one tier.
   - **Sell:** pick any tower and remove it. You get the usual 50 % refund in caps, which only adds to the score.
   - **Ring the bell:** the current bell effect (every guest present pays out and leaves).
2. **One card per turn.** On your turn you play at most one card, or none, then end the turn. The 3-action counter and the 10-caps bonus for unused actions are removed.
3. **Hand.**
   - You start with **3 cards**.
   - At the start of each later player turn you draw **1 card**.
   - The hand holds at most **7**. With a full hand you don't draw.
   - Unplayed cards stay.
4. **Unplayable cards** stay in the hand, faded, and can't be played. Examples: Upgrade with no matching tower below max tier, Sell with no towers, Build with no free tile, Bell with no guests on the board.
5. **Caps** cost nothing for cards. Kill rewards, sell refunds and bell payouts still add caps. The HUD shows them as a score. Weapon `cost` in the data is ignored in play; the data and editor are unchanged.
6. **The bell** exists only as a card. The free once-per-level bell button goes away.
7. **UI.**
   - The build menu in the side panel becomes the **hand**: one card per row, with icon, title and hotkey 1–7.
   - Clicking a card selects it, and its target is then picked on the map: a tile for Build, a tower for Upgrade or Sell. The Bell plays at once.
   - Esc cancels. Clicking the selected card again deselects it.
   - The tower panel shows a tower's stats only; its upgrade and sell buttons are removed.
   - The HUD shows "Card played" / "Play 1 card" in place of the action dots.
   - End turn ▶ and Space are unchanged.
   - The card drawn each turn is briefly highlighted.
8. **How-to text** explains the cards in place of actions and costs.

## Non-goals

- Deck building, discarding, card costs or mana.
- Data model, DB or editor changes.
- Changes to the guests' turn rules.

## Anti-goals

- A starting hand that can't build anything.
- Caps still gating any action.
- A turn soft-locked because the selected card has no valid target: it can always be cancelled.

## Approaches

- **A. One card per turn (chosen by the author).** Draw 1, play at most 1, keep the rest. It fits "draw one, keep the rest", and skipping a turn grows your hand. It's simple to explain.
- B. Up to 3 cards per turn, like today's actions. You would need to draw 3 per turn, and holding cards back would matter little. Not chosen.

## Deck (controller's calls, author can override)

- The deck is infinite: each draw is rolled independently with the injected RNG, so tests are seeded.
- Each draw rolls a kind first, then a weapon uniformly from the level's `weaponIds`:

  | Kind | Weight |
  |------|--------|
  | Build | 55 % |
  | Upgrade | 30 % |
  | Sell | 10 % |
  | Bell | 5 % |

  If a level has no weapon with upgrades, the Upgrade weight is redrawn as Build.
- **Starting hand:** 3 cards, at least 2 of them Build cards with different weapons where the level has 2 or more.

## Engine (controller's calls)

- `GameState.hand` is an array of `{ id, kind, weaponId? }`.
- A new `playCard(cardId, target)` returns `{ ok, reason }` with these reasons:
  - `card-played`: already played one this turn
  - `unknown-card`
  - `no-target`
  - `not-buildable`
  - `wrong-weapon`
  - `max-tier`
  - `game-over`
  - `guests-turn`
- Bell plays return events as `ringBell` does today.
- `placeTower`, `upgradeTower` and `sellTower` become internal helpers without cost or action checks.
- `cardPlayable(card)` drives the fading in the UI.
- At the start of each player turn after the first, `endTurn` draws a card unless the game ended. It emits a `draw` event with the card.

## Balance (controller's calls)

- The bots in `game/logic/bot.js` play cards. The sensible bot picks the best card each turn:
  - Build on the tile with the most path coverage, preferring higher `weaponScore` without the cost term.
  - Otherwise Upgrade the matching tower with the most coverage.
  - It never sells or rings the bell.
- The mixed bot keeps its 2-damage : 1-support preference among the cards it holds.
- The existing balance tests are kept in spirit:
  - The sensible bot wins both starter levels over the test seeds.
  - The idle bot loses.
  - Level 1 is easier than level 2.
- Turn limits, level tuning (`startingWine`, wave sizes) and deck weights may be re-tuned to make that hold.
- Tests that are about caps economics, like "mixed beats the best single weapon per cap", are rewritten or dropped where cost no longer means anything. Each drop is noted in the commit.

## Left to the builder

- Card visuals within the existing card style, and the draw animation.
- How the hand panel and the tower panel share the side column.
- Module split (e.g. `game/logic/cards.js`).
