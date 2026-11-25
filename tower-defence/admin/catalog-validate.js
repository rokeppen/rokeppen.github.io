// Pure validation for the catalog editors (no DOM). Each function returns a list of
// human-readable problems; an empty list means the item is valid to save.
import { validateLevel } from '../shared/model.js';

export const EFFECTS = ['none', 'slow', 'distract', 'lure', 'splash'];
export const UPGRADE_FIELDS = ['cost', 'damage', 'range', 'fireRate', 'effectStrength'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// min: 'positive' (> 0) or 'zero' (>= 0). int: DB column is an integer.
function checkNumber(errors, label, v, { zeroOk = false, int = false } = {}) {
  if (!isNum(v)) return errors.push(`${label} must be a number`);
  if (zeroOk ? v < 0 : v <= 0) return errors.push(`${label} must be ${zeroOk ? '0 or more' : 'greater than 0'}`);
  if (int && !Number.isInteger(v)) errors.push(`${label} must be a whole number`);
}

function checkIdName(errors, item) {
  if (typeof item.id !== 'string' || !item.id.trim()) errors.push('id is required');
  if (typeof item.name !== 'string' || !item.name.trim()) errors.push('name is required');
}

export function validateWeapon(w) {
  const errors = [];
  checkIdName(errors, w);
  checkNumber(errors, 'cost', w.cost, { int: true });
  checkNumber(errors, 'range', w.range);
  checkNumber(errors, 'damage', w.damage, { zeroOk: true });
  checkNumber(errors, 'fireRate', w.fireRate);
  if (!EFFECTS.includes(w.effect)) {
    errors.push(`effect must be one of ${EFFECTS.join(', ')}`);
  }
  checkNumber(errors, 'effectStrength', w.effectStrength, { zeroOk: true });
  if (w.effect !== 'none' && EFFECTS.includes(w.effect)) {
    checkNumber(errors, 'effectDuration', w.effectDuration);
    if (w.effect === 'slow' && isNum(w.effectStrength) && w.effectStrength >= 1) {
      errors.push('effectStrength must be below 1 for slow');
    }
  }
  (w.upgrades ?? []).forEach((u, i) => {
    const tier = `upgrade ${i + 1}`;
    for (const k of Object.keys(u)) {
      if (!UPGRADE_FIELDS.includes(k)) errors.push(`${tier}: unknown field ${k}`);
    }
    checkNumber(errors, `${tier} cost`, u.cost, { int: true });
    for (const k of ['damage', 'range', 'fireRate', 'effectStrength']) {
      if (u[k] === undefined) continue;
      checkNumber(errors, `${tier} ${k}`, u[k], { zeroOk: k === 'damage' || k === 'effectStrength' });
    }
    if (w.effect === 'slow' && isNum(u.effectStrength) && u.effectStrength >= 1) {
      errors.push(`${tier}: effectStrength must be below 1 for slow`);
    }
  });
  return errors;
}

export function validateEnemy(e) {
  const errors = [];
  checkIdName(errors, e);
  checkNumber(errors, 'hp', e.hp);
  checkNumber(errors, 'speed', e.speed);
  checkNumber(errors, 'reward', e.reward, { int: true });
  checkNumber(errors, 'wineDamage', e.wineDamage, { int: true });
  return errors;
}

// Names of levels that reference a weapon (weaponIds) or an enemy (wave group enemyId).
// Tolerates malformed raw levels (the admin loads invalid ones so they can be repaired).
export function levelsUsing(levels, { weaponId, enemyId } = {}) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  return arr(levels)
    .filter((l) => l && (
      (weaponId !== undefined && arr(l.weaponIds).includes(weaponId))
      || (enemyId !== undefined && arr(l.waves).some((w) => arr(w).some((g) => g?.enemyId === enemyId)))))
    .map((l) => String(l.name ?? l.id ?? '(unnamed level)'));
}

// Names of levels that are playable now but would fail validation (and so be hidden from the
// game) once this weapon/enemy is deleted: left with no weapons, or every wave emptied.
export function levelsHiddenByDelete(levels, catalog, { weaponId, enemyId } = {}) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const weapons = arr(catalog?.weapons);
  const enemies = arr(catalog?.enemies);
  const after = {
    weapons: weapons.filter((w) => w?.id !== weaponId),
    enemies: enemies.filter((e) => e?.id !== enemyId),
  };
  return arr(levels)
    .filter((l) => l && validateLevel(l, { weapons, enemies }).level && !validateLevel(l, after).level)
    .map((l) => String(l.name ?? l.id ?? '(unnamed level)'));
}
