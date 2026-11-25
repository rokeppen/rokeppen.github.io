// Data layer: Supabase first, bundled fallback-data.json second.
// No CDN imports here: the supabase client and the fallback fetcher are injected.
import { prepareGameData } from './model.js';
import {
  weaponFromRow, weaponToRow, enemyFromRow, enemyToRow, levelFromRow, levelToRow,
} from './mapping.js';

const errorMessage = (e) => e?.message ?? String(e);

async function selectAll(client, table) {
  const { data, error } = await client.from(table).select('*');
  if (error) throw new Error(`${table}: ${errorMessage(error)}`);
  return data ?? [];
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`database timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function write(run) {
  try {
    const { error } = await run();
    return error ? { ok: false, error: errorMessage(error) } : { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export function createDataSource({ client, fetchFallback, timeoutMs = 3000 }) {
  // Raw app-shape data straight from the DB (no validation, all levels).
  async function readDb() {
    const [weapons, enemies, levels] = await Promise.all([
      selectAll(client, 'weapons'),
      selectAll(client, 'enemies'),
      selectAll(client, 'levels'),
    ]);
    return {
      weapons: weapons.map(weaponFromRow),
      enemies: enemies.map(enemyFromRow),
      levels: levels.map(levelFromRow),
    };
  }

  async function loadGameData({ includeUnpublished = false } = {}) {
    let reason;
    try {
      const raw = await withTimeout(readDb(), timeoutMs);
      const prepared = prepareGameData(raw, { includeUnpublished });
      if (prepared.levels.length > 0) return { ...prepared, source: 'db' };
      reason = 'database has no valid levels';
    } catch (e) {
      reason = errorMessage(e);
    }
    console.warn(`Using fallback data: ${reason}`);
    const raw = await fetchFallback();
    return { ...prepareGameData(raw, { includeUnpublished }), source: 'fallback' };
  }

  const upsert = (table, row) => write(() => client.from(table).upsert(row));
  const remove = (table, id) => write(() => client.from(table).delete().eq('id', id));

  return {
    loadGameData,
    saveLevel: (level) => upsert('levels', levelToRow(level)),
    deleteLevel: (id) => remove('levels', id),
    saveWeapon: (w) => upsert('weapons', weaponToRow(w)),
    deleteWeapon: (id) => remove('weapons', id),
    saveEnemy: (e) => upsert('enemies', enemyToRow(e)),
    deleteEnemy: (id) => remove('enemies', id),
    async exportJson() {
      const { weapons, enemies, levels } = await readDb();
      levels.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      return JSON.stringify({ weapons, enemies, levels }, null, 2);
    },
  };
}
