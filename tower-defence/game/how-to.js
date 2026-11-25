// Pure "how to play" content (no Phaser). MenuScene draws the rows; GameScene uses CAFE_STATUS.

// Shown above a guest sitting at the Café (distracted). Matches the Café's sprite and is
// distinct from the beer bar's 🍻.
export const CAFE_STATUS = '🪑';

const joinNames = (names) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

// The guests in the data that the Café can't distract, as one how-to row (null if none).
function immuneRow(enemies) {
  const immune = (enemies ?? []).filter((e) => Array.isArray(e?.immuneTo) && e.immuneTo.includes('distract'));
  if (immune.length === 0) return null;
  const first = immune[0];
  return [
    { enemy: first.id, fallback: first.fallbackSprite || '👤' },
    `${joinNames(immune.map((e) => e.name))}: immune to the Café. Stop them another way.`,
  ];
}

// [icon, text] rows; an icon may be { weapon | enemy: id, fallback } to use that item's sprite.
export function howToPlay(data) {
  return [
    ['🗺️', 'Place office weapons on the floor beside the carpet, never on it.'],
    ['🃏', 'Play one card per turn (build, upgrade, sell, bell). You draw one each turn; the rest stay.'],
    ['🚶', 'Then the guests walk the carpet tile by tile, up to their speed, toward the beer bar 🍻 and drain your kegs 🍺.'],
    ['🎯', 'Your weapons fire as guests pass, after every step. Guests escorted out pay bottle caps 🧢.'],
    ['⬆️', 'Upgrade and Sell cards target a weapon on the floor. Cards are free; caps 🧢 are your score.'],
    [{ weapon: 'cafe', fallback: '🪑' }, 'Café: a cosy pub corner no guest can resist. Distracts one guest at a time.'],
    immuneRow(data?.enemies),
    [{ weapon: 'pizza-hut', fallback: '🍕' }, 'Pizza Hut Delivery: free pizza lures the whole crowd and stalls them.'],
    ['🔔', 'Nexios Victory Bell card: clears the room and pays caps too!'],
    [{ weapon: 'out-of-office', fallback: '📧' }, 'Out-of-Office, Coffee Machine (slows) and HR Talk (splash) do the rest.'],
  ].filter(Boolean);
}
