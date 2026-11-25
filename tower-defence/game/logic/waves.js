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
