// Pure timing plan for the guests' turn (no Phaser). GameState.endTurn() returns every
// event of the turn at once; the scene plays them back as "beats", round by round:
//   - bonus (round -1) first, then rounds in ascending order;
//   - in each round, a beat with the movement and other non-firing events (steps, leaks,
//     spawns, quotes, wave and end-of-turn events), then a beat with its shots, effects
//     and kills (the engine fires after moving, so this is also the engine's order).
// `ms` is how long to wait after a beat before the next one starts; a move beat also has
// `stepMs`, the duration of its tile-to-tile tweens. Long walks stay snappy: when the
// rounds with steps would take more than WALK_CAP_MS, every step gets shorter.

export const STEP_MS = 120;  // one tile-to-tile step
export const FIRE_MS = 90;   // a round of shots
export const OPEN_MS = 150;  // a wave starting / guests arriving at the door
export const SETTLE_MS = 250; // after the last beat, before the player gets control back
export const FAST_FACTOR = 3;
export const WALK_CAP_MS = 700; // all the steps of one guests' turn, at 1x
export const MIN_STEP_MS = 40;

const FIRE = new Set(['shot', 'effect', 'kill']);
const MOVE = new Set(['step', 'leak']);
const ARRIVE = new Set(['spawn', 'wave-start']);

export function scaleMs(ms, fast) {
  return fast ? Math.round(ms / FAST_FACTOR) : ms;
}

export function planPlayback(events, { fast = false } = {}) {
  const rounds = new Map();
  for (const ev of events) {
    const round = Number.isFinite(ev.round) ? ev.round : 0;
    if (!rounds.has(round)) rounds.set(round, []);
    rounds.get(round).push(ev);
  }
  const moveRounds = [...rounds.values()].filter((list) => list.some((e) => MOVE.has(e.type))).length;
  const stepMs = moveRounds * STEP_MS > WALK_CAP_MS
    ? Math.max(MIN_STEP_MS, Math.floor(WALK_CAP_MS / moveRounds)) : STEP_MS;
  const beats = [];
  for (const round of [...rounds.keys()].sort((a, b) => a - b)) {
    const list = rounds.get(round);
    const other = list.filter((e) => !FIRE.has(e.type));
    const fire = list.filter((e) => FIRE.has(e.type));
    if (other.length > 0) {
      const moves = other.some((e) => MOVE.has(e.type));
      const ms = moves ? stepMs : other.some((e) => ARRIVE.has(e.type)) ? OPEN_MS : 0;
      const beat = { round, kind: moves ? 'move' : 'open', events: other, ms: scaleMs(ms, fast) };
      if (moves) beat.stepMs = scaleMs(stepMs, fast);
      beats.push(beat);
    }
    if (fire.length > 0) {
      const ms = fire.some((e) => e.type === 'shot') ? FIRE_MS : 0;
      beats.push({ round, kind: 'fire', events: fire, ms: scaleMs(ms, fast) });
    }
  }
  return beats;
}
