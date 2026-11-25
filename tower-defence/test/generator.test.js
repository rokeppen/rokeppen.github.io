import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPathValid, validateLevel } from '../shared/model.js';
import { canSave } from '../admin/editor-state.js';
import {
  SIZES, DIFFICULTIES, canGenerate, generateLevel, randomSeed,
} from '../shared/generator.js';

const fullCatalog = JSON.parse(readFileSync(new URL('../fallback-data.json', import.meta.url), 'utf8'));
const fullOpts = {
  enemyIds: fullCatalog.enemies.map((e) => e.id),
  weaponIds: fullCatalog.weapons.map((w) => w.id),
};

const tinyCatalog = {
  weapons: [{ id: 'gun', cost: 40, damage: 5 }],
  enemies: [{ id: 'bob', hp: 20, speed: 1, wineDamage: 1 }],
};
const tinyOpts = { enemyIds: ['bob'], weaponIds: ['gun'] };

// Three guests of clearly different toughness, plus a non-damage weapon.
const mixedCatalog = {
  weapons: [
    { id: 'cheap', cost: 30, damage: 4 },
    { id: 'slow', cost: 60, damage: 0 },
    { id: 'big', cost: 120, damage: 20 },
  ],
  enemies: [
    { id: 'weak', hp: 10, speed: 1, wineDamage: 1 },
    { id: 'mid', hp: 40, speed: 1, wineDamage: 1 },
    { id: 'boss', hp: 300, speed: 0.5, wineDamage: 5 },
  ],
};
const mixedOpts = { enemyIds: ['boss', 'weak', 'mid'], weaponIds: ['cheap', 'slow', 'big'] };

// Heavy easy guests plus very light guests that are "tough" through speed and wineDamage.
const zipCatalog = {
  weapons: [{ id: 'gun', cost: 40, damage: 5 }],
  enemies: [
    { id: 'tank', hp: 100, speed: 1, wineDamage: 1 },
    { id: 'tank2', hp: 120, speed: 1, wineDamage: 1 },
    { id: 'zip', hp: 5, speed: 10, wineDamage: 10 },
    { id: 'zip2', hp: 4, speed: 10, wineDamage: 10 },
  ],
};
const zipOpts = { enemyIds: ['tank', 'tank2', 'zip', 'zip2'], weaponIds: ['gun'] };

const base = { size: 'medium', difficulty: 'party', twistiness: 0.5, waves: 6, seed: 1 };
const asSaved = (lvl) => ({ ...lvl, id: 'x', sortOrder: 0, published: false });
const spawnCount = (lvl) => lvl.waves.flat().reduce((n, g) => n + g.count, 0);
const hpOf = (cat) => Object.fromEntries(cat.enemies.map((e) => [e.id, e.hp]));

test('exports sizes and difficulties', () => {
  assert.deepEqual(SIZES, { small: [12, 8], medium: [16, 10], large: [20, 12] });
  assert.deepEqual(DIFFICULTIES, ['chill', 'party', 'chaos']);
});

// Count bounds checked across the whole RF3 grid.
const MAX_GROWTH = 2.5; // a wave never has more than 2.5x the guests of the wave before it
const MAX_GROUP = 60; // no single group is bigger than this
const MAX_WAVE = 120; // no wave is bigger than this (worst case: 20-wave Chaos)

test('RF3: every combination yields a valid, saveable level with sane guest counts', () => {
  const t0 = Date.now();
  const cases = [[tinyCatalog, tinyOpts], [mixedCatalog, mixedOpts], [zipCatalog, zipOpts], [fullCatalog, fullOpts]];
  for (const [catalog, lists] of cases) {
    const tough = (e) => e.hp * e.speed * e.wineDamage;
    const toughest = [...catalog.enemies].sort((a, b) => tough(b) - tough(a))[0].id;
    for (let seed = 0; seed < 60; seed++) {
      for (const size of Object.keys(SIZES)) {
        for (const difficulty of DIFFICULTIES) {
          for (const twistiness of [0, 0.5, 1]) {
            for (const waves of [1, 6, 20]) {
              const opts = { ...lists, size, difficulty, twistiness, waves, seed: seed * 7919 + 13 };
              const lvl = generateLevel(opts, catalog);
              // Messages are built only on failure; building them eagerly dominated the run time.
              const check = (ok, what) => {
                if (!ok) assert.fail(`${JSON.stringify({ size, difficulty, twistiness, waves, seed: opts.seed })}: ${what()}`);
              };
              check(isPathValid(lvl.path, lvl.start, lvl.end, lvl.cols, lvl.rows), () => 'path invalid');
              const res = validateLevel(asSaved(lvl), catalog);
              check(res.level && res.errors.length === 0, () => `validateLevel: ${res.errors}`);
              check(lvl.waves.length === waves, () => `${lvl.waves.length} waves`);
              check(lvl.cols === SIZES[size][0] && lvl.rows === SIZES[size][1], () => 'wrong size');
              const saved = canSave(asSaved(lvl), catalog);
              check(saved.ok && saved.errors.length === 0, () => `canSave: ${saved.errors}`);
              const counts = lvl.waves.map((w) => w.reduce((n, g) => n + g.count, 0));
              counts.forEach((c, i) => {
                check(c <= MAX_WAVE, () => `wave ${i + 1} has ${c} guests`);
                if (i > 0) check(c <= MAX_GROWTH * counts[i - 1], () => `counts ${counts}`);
              });
              for (const g of lvl.waves.flat()) check(g.count <= MAX_GROUP, () => `group of ${g.count}`);
              const appearing = new Set(lvl.waves.flat().map((g) => g.enemyId));
              for (const id of lists.enemyIds) check(appearing.has(id), () => `guest ${id} never appears`);
              if (waves >= 4 && lists.enemyIds.length >= 2) {
                check(!lvl.waves[0].some((g) => g.enemyId === toughest), () => 'toughest in wave 1');
              }
            }
          }
        }
      }
    }
  }
  console.log(`RF3 grid: ${Date.now() - t0} ms`);
});

test('20-wave Chaos stays within the per-wave and per-group caps', () => {
  for (const [catalog, lists] of [[tinyCatalog, tinyOpts], [mixedCatalog, mixedOpts], [zipCatalog, zipOpts], [fullCatalog, fullOpts]]) {
    for (let seed = 0; seed < 200; seed++) {
      const lvl = generateLevel({ ...base, ...lists, difficulty: 'chaos', waves: 20, seed }, catalog);
      for (const w of lvl.waves) {
        assert.ok(w.reduce((n, g) => n + g.count, 0) <= MAX_WAVE, `seed ${seed}`);
        for (const g of w) assert.ok(g.count <= MAX_GROUP, `seed ${seed}`);
      }
    }
  }
});

test('non-positive or missing guest stats do not break generation', () => {
  const odd = {
    weapons: [{ id: 'gun', cost: 40, damage: 5 }],
    enemies: [
      { id: 'zero', hp: 0, speed: 0, wineDamage: 0 },
      { id: 'neg', hp: -5, speed: -1, wineDamage: -2 },
      { id: 'none' },
      { id: 'ok', hp: 50, speed: 1, wineDamage: 1 },
    ],
  };
  const lists = { enemyIds: ['zero', 'neg', 'none', 'ok'], weaponIds: ['gun'] };
  for (let seed = 0; seed < 20; seed++) {
    for (const difficulty of DIFFICULTIES) {
      const lvl = generateLevel({ ...base, ...lists, difficulty, waves: 20, seed }, odd);
      assert.deepEqual(validateLevel(asSaved(lvl), odd).errors, []);
      for (const g of lvl.waves.flat()) assert.ok(g.count <= MAX_GROUP);
    }
  }
});

test('shape: name, bar sprite, no id/published/sortOrder, start and end on different edges', () => {
  for (let seed = 0; seed < 40; seed++) {
    for (const size of Object.keys(SIZES)) {
      const lvl = generateLevel({ ...base, ...fullOpts, size, seed }, fullCatalog);
      assert.equal(lvl.name, `Generated party #${seed}`);
      assert.equal(lvl.barSprite, '🍻');
      assert.ok(!('id' in lvl) && !('published' in lvl) && !('sortOrder' in lvl));
      const edges = (p) => [
        p.x === 0 && 'left', p.x === lvl.cols - 1 && 'right',
        p.y === 0 && 'top', p.y === lvl.rows - 1 && 'bottom',
      ].filter(Boolean);
      const se = edges(lvl.start);
      const ee = edges(lvl.end);
      assert.equal(se.length, 1, 'start on exactly one edge');
      assert.equal(ee.length, 1, 'end on exactly one edge');
      assert.notEqual(se[0], ee[0]);
    }
  }
});

test('deterministic: same opts deep-equal, different seed different path', () => {
  const a = generateLevel({ ...base, ...fullOpts, seed: 42 }, fullCatalog);
  const b = generateLevel({ ...base, ...fullOpts, seed: 42 }, fullCatalog);
  assert.deepEqual(a, b);
  const c = generateLevel({ ...base, ...fullOpts, seed: 43 }, fullCatalog);
  assert.notDeepEqual(a.path, c.path);
  const paths = new Set();
  for (let seed = 0; seed < 30; seed++) {
    paths.add(JSON.stringify(generateLevel({ ...base, ...fullOpts, seed }, fullCatalog).path));
  }
  assert.ok(paths.size >= 25, `only ${paths.size} distinct paths`);
});

test('only listed guests and weapons appear', () => {
  const catalog = fullCatalog;
  const enemyIds = [catalog.enemies[0].id, catalog.enemies[1].id, 'not-in-catalog'];
  const weaponIds = [catalog.weapons[0].id, 'nope'];
  for (let seed = 0; seed < 20; seed++) {
    const lvl = generateLevel({ ...base, waves: 10, enemyIds, weaponIds, seed }, catalog);
    assert.deepEqual(lvl.enemyIds, enemyIds.slice(0, 2));
    assert.deepEqual(lvl.weaponIds, weaponIds.slice(0, 1));
    for (const g of lvl.waves.flat()) assert.ok(lvl.enemyIds.includes(g.enemyId));
  }
});

test('blocked tiles: off the path, in bounds, unique, 6-12% of free tiles', () => {
  for (let seed = 0; seed < 30; seed++) {
    for (const size of Object.keys(SIZES)) {
      for (const twistiness of [0, 1]) {
        const lvl = generateLevel({ ...base, ...fullOpts, size, twistiness, seed }, fullCatalog);
        const onPath = new Set(lvl.path.map((p) => `${p.x},${p.y}`));
        const keys = new Set(lvl.blocked.map((b) => `${b.x},${b.y}`));
        assert.equal(keys.size, lvl.blocked.length);
        for (const k of keys) assert.ok(!onPath.has(k));
        const free = lvl.cols * lvl.rows - lvl.path.length;
        const ratio = lvl.blocked.length / free;
        assert.ok(ratio >= 0.06 && ratio <= 0.12, `ratio ${ratio}`);
      }
    }
  }
});

test('mean path length grows with twistiness', () => {
  for (const size of Object.keys(SIZES)) {
    const mean = (twistiness) => {
      let sum = 0;
      for (let seed = 0; seed < 30; seed++) {
        sum += generateLevel({ ...base, ...fullOpts, size, twistiness, seed }, fullCatalog).path.length;
      }
      return sum / 30;
    };
    const lo = mean(0);
    const mid = mean(0.5);
    const hi = mean(1);
    assert.ok(hi > mid && mid > lo, `${size}: ${lo} ${mid} ${hi}`);
  }
});

test('chaos spawns more guests with shorter intervals than party, party more than chill', () => {
  for (let seed = 0; seed < 30; seed++) {
    const [chill, party, chaos] = DIFFICULTIES.map((difficulty) =>
      generateLevel({ ...base, ...fullOpts, difficulty, seed }, fullCatalog));
    assert.ok(spawnCount(chaos) > spawnCount(party), `seed ${seed}`);
    assert.ok(spawnCount(party) > spawnCount(chill), `seed ${seed}`);
    const meanInterval = (l) => {
      const gs = l.waves.flat();
      return gs.reduce((s, g) => s + g.intervalS, 0) / gs.length;
    };
    assert.ok(meanInterval(chaos) < meanInterval(party), `seed ${seed}`);
    assert.ok(meanInterval(party) < meanInterval(chill), `seed ${seed}`);
  }
});

test('waves escalate: total HP grows every wave', () => {
  for (const [catalog, lists] of [[fullCatalog, fullOpts], [mixedCatalog, mixedOpts], [zipCatalog, zipOpts], [tinyCatalog, tinyOpts]]) {
    const hp = hpOf(catalog);
    for (let seed = 0; seed < 30; seed++) {
      for (const difficulty of DIFFICULTIES) {
        const lvl = generateLevel({ ...base, ...lists, difficulty, waves: 20, seed }, catalog);
        const totals = lvl.waves.map((w) => w.reduce((s, g) => s + g.count * hp[g.enemyId], 0));
        for (let i = 1; i < totals.length; i++) assert.ok(totals[i] > totals[i - 1], `${totals}`);
      }
    }
  }
});

test('the toughest guest only appears in the later half of the waves', () => {
  for (let seed = 0; seed < 40; seed++) {
    for (const waves of [4, 5, 8, 20]) {
      const lvl = generateLevel({ ...base, ...mixedOpts, waves, seed }, mixedCatalog);
      assert.ok(!lvl.waves[0].some((g) => g.enemyId === 'boss'), `seed ${seed}, waves ${waves}`);
      lvl.waves.forEach((w, i) => {
        if (i < Math.floor(waves / 2)) assert.ok(!w.some((g) => g.enemyId === 'boss'));
      });
    }
    // Full catalog: toughness = hp x speed x wineDamage.
    const tough = (e) => e.hp * e.speed * e.wineDamage;
    const toughest = [...fullCatalog.enemies].sort((a, b) => tough(b) - tough(a))[0].id;
    const lvl = generateLevel({ ...base, ...fullOpts, waves: 6, seed }, fullCatalog);
    assert.ok(!lvl.waves[0].some((g) => g.enemyId === toughest));
  }
});

test('starting resources', () => {
  const wine = { chill: 20, party: 12, chaos: 8 };
  for (let seed = 0; seed < 10; seed++) {
    for (const [catalog, lists] of [[fullCatalog, fullOpts], [mixedCatalog, mixedOpts], [tinyCatalog, tinyOpts]]) {
      const cheapest = Math.min(...catalog.weapons.filter((w) => lists.weaponIds.includes(w.id)).map((w) => w.cost));
      const corks = DIFFICULTIES.map((difficulty) => {
        const lvl = generateLevel({ ...base, ...lists, difficulty, seed }, catalog);
        assert.equal(lvl.startingWine, wine[difficulty]);
        assert.ok(Number.isInteger(lvl.startingCorks) && lvl.startingCorks >= 2 * cheapest);
        return lvl.startingCorks;
      });
      assert.ok(corks[0] >= corks[1] && corks[1] >= corks[2], `${corks}`);
    }
  }
});

test('canGenerate', () => {
  const ok = { ...base, ...mixedOpts };
  assert.deepEqual(canGenerate(ok, mixedCatalog), { ok: true });

  const noDamage = canGenerate({ ...ok, weaponIds: ['slow'] }, mixedCatalog);
  assert.equal(noDamage.ok, false);
  assert.match(noDamage.reason, /weapon/i);

  const noGuests = canGenerate({ ...ok, enemyIds: ['ghost'] }, mixedCatalog);
  assert.equal(noGuests.ok, false);
  assert.match(noGuests.reason, /guest/i);

  for (const waves of [0, 21, 2.5, '3', undefined]) {
    const r = canGenerate({ ...ok, waves }, mixedCatalog);
    assert.equal(r.ok, false, String(waves));
    assert.match(r.reason, /wave/i);
  }
  assert.equal(canGenerate({ ...ok, waves: 20 }, mixedCatalog).ok, true);
  assert.equal(canGenerate({ ...ok, size: 'huge' }, mixedCatalog).ok, false);
  assert.equal(canGenerate({ ...ok, difficulty: 'rave' }, mixedCatalog).ok, false);
  assert.throws(() => generateLevel({ ...ok, weaponIds: ['slow'] }, mixedCatalog), /weapon/i);
});

test('randomSeed returns a uint32', () => {
  for (let i = 0; i < 20; i++) {
    const s = randomSeed();
    assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff);
  }
});
