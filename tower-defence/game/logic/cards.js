// Action cards (pure, no Phaser). The deck is infinite: every draw is rolled on its own
// with the injected RNG. A card is { kind, weaponId? }; GameState adds an id.
// See docs/superpowers/specs/2026-11-25-cards-design.md.

export const CARD_KINDS = ['build', 'upgrade', 'sell', 'bell'];
export const CARD_WEIGHTS = { build: 0.55, upgrade: 0.30, sell: 0.10, bell: 0.05 };
export const HAND_START = 3;
export const HAND_MAX = 7;

const pick = (rng, list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
const upgradable = (weapons) => weapons.filter((w) => (w.upgrades || []).length > 0);

function buildCard(rng, weapons) {
  return { kind: 'build', weaponId: pick(rng, weapons).id };
}

// `weapons`: the level's weapon definitions.
export function rollCard(rng, weapons) {
  let r = rng();
  let kind = CARD_KINDS[CARD_KINDS.length - 1];
  for (const k of CARD_KINDS) {
    if (r < CARD_WEIGHTS[k]) { kind = k; break; }
    r -= CARD_WEIGHTS[k];
  }
  if (kind === 'upgrade') {
    const ups = upgradable(weapons);
    if (ups.length === 0) return buildCard(rng, weapons);
    return { kind, weaponId: pick(rng, ups).id };
  }
  if (kind === 'build') return buildCard(rng, weapons);
  return { kind };
}

// Two Build cards (different weapons when the level has 2 or more), then one rolled card.
export function startingHand(rng, weapons) {
  const first = buildCard(rng, weapons);
  const others = weapons.filter((w) => w.id !== first.weaponId);
  const second = others.length > 0 ? { kind: 'build', weaponId: pick(rng, others).id } : { ...first };
  return [first, second, rollCard(rng, weapons)];
}

export function cardTitle(card, weaponDefs) {
  const name = card.weaponId ? weaponDefs.get(card.weaponId)?.name ?? card.weaponId : '';
  if (card.kind === 'build') return `Build ${name}`;
  if (card.kind === 'upgrade') return `Upgrade ${name}`;
  if (card.kind === 'sell') return 'Sell a weapon';
  return 'Ring the bell';
}
