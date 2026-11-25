// Flatten a wave (array of groups) into a time-sorted spawn list.
// Array.prototype.sort is stable, so ties keep group order.
export function buildSpawnSchedule(wave) {
  const spawns = [];
  for (const g of wave) {
    for (let i = 0; i < g.count; i++) {
      spawns.push({ time: g.delayS + i * g.intervalS, enemyId: g.enemyId });
    }
  }
  return spawns.sort((p, q) => p.time - q.time);
}

// Turn-based schedule: 1 s in data = 1 turn. Guest k of a group spawns in the wave's
// guests' turn floor(delayS + k * intervalS) (0-based). A tiny epsilon keeps float
// noise such as 3 * (1/3) = 0.9999999999999999 on the intended turn.
export function buildSpawnTurns(wave) {
  return buildSpawnSchedule(wave).map(({ time, enemyId }) => ({ turn: Math.floor(time + 1e-9), enemyId }));
}
