// Usage: npm run seed  (from tower-defence/)
// Reads fallback-data.json and writes supabase/seed.sql with idempotent upserts.
import { readFileSync, writeFileSync } from 'node:fs';
import { toSeedSql } from '../shared/seed-sql.js';

const source = new URL('../fallback-data.json', import.meta.url);
const target = new URL('../supabase/seed.sql', import.meta.url);

const data = JSON.parse(readFileSync(source, 'utf8'));
writeFileSync(target, toSeedSql(data));
console.log(
  `Wrote supabase/seed.sql: ${data.weapons?.length ?? 0} weapons, ` +
  `${data.enemies?.length ?? 0} enemies, ${data.levels?.length ?? 0} levels.`,
);
