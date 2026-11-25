const FIELDS = ['damage', 'range', 'fireRate', 'effectStrength'];

// Tier 0 is the base weapon; tier n applies upgrades[0..n-1] in order.
// Tiers beyond the last upgrade clamp to max.
export function weaponStats(weapon, tier) {
  const upgrades = weapon.upgrades || [];
  const n = Math.min(Math.max(tier, 0), upgrades.length);
  const stats = {};
  for (const f of FIELDS) stats[f] = weapon[f];
  for (let i = 0; i < n; i++) {
    for (const f of FIELDS) {
      if (upgrades[i][f] !== undefined && upgrades[i][f] !== null) stats[f] = upgrades[i][f];
    }
  }
  return stats;
}

// Cost of going from `tier` to `tier + 1`; null when already at max.
export function upgradeCost(weapon, tier) {
  const next = (weapon.upgrades || [])[tier];
  return next ? next.cost : null;
}
