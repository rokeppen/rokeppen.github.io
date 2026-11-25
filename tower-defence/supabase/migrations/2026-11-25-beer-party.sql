-- Beer party refresh: guest quotes/immunities, fallback emoji, per-level guest lists,
-- bar sprite, Café replaces Wine Tasting, and the `sprites` Storage bucket.
-- For an existing project that already ran schema.sql. Idempotent: safe to re-run.
-- Run this first, then seed.sql.

-- 1. New columns
alter table public.weapons add column if not exists fallback_sprite text;

alter table public.enemies add column if not exists quotes jsonb not null default '[]'::jsonb;
alter table public.enemies add column if not exists immune_to text[] not null default '{}';
alter table public.enemies add column if not exists fallback_sprite text;

-- Guest list; null = legacy row (the app derives it from the waves). No default on purpose.
alter table public.levels add column if not exists enemy_ids text[];
alter table public.levels add column if not exists bar_sprite text not null default '🍻';

-- 2. Backfill guest lists from the enemy ids used in each level's waves
update public.levels l
set enemy_ids = coalesce((
  select array_agg(distinct grp->>'enemyId')
  from jsonb_array_elements(case when jsonb_typeof(l.waves) = 'array' then l.waves else '[]'::jsonb end) as w(wave),
       jsonb_array_elements(case when jsonb_typeof(wave) = 'array' then wave else '[]'::jsonb end) as g(grp)
  where grp->>'enemyId' is not null
), '{}')
where l.enemy_ids is null;

-- 3. Café replaces Wine Tasting in every level (no duplicate when Café is already there)
update public.levels
set weapon_ids = case
  when 'cafe' = any(weapon_ids) then array_remove(weapon_ids, 'wine-tasting')
  else array_replace(weapon_ids, 'wine-tasting', 'cafe')
end
where 'wine-tasting' = any(weapon_ids);

-- The `cafe` weapon row itself comes from seed.sql (no foreign key on weapon_ids).
delete from public.weapons where id = 'wine-tasting';

-- 4. Admin check (unchanged from schema.sql; re-created so this file stands on its own)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- 5. Table grants (as in schema.sql)
grant usage on schema public to anon, authenticated;
grant select on public.weapons, public.enemies, public.levels to anon, authenticated;
grant insert, update, delete on public.weapons, public.enemies, public.levels to authenticated;
grant select on public.admins to authenticated;

-- 6. Storage: admin-uploaded sprite images. Public read, admin-only write, max 1 MB, images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sprites', 'sprites', true, 1048576,
  array['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- storage.objects already has RLS enabled by Supabase.
drop policy if exists sprites_public_read on storage.objects;
create policy sprites_public_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'sprites');
drop policy if exists sprites_admin_insert on storage.objects;
create policy sprites_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'sprites' and public.is_admin());
drop policy if exists sprites_admin_update on storage.objects;
create policy sprites_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'sprites' and public.is_admin())
  with check (bucket_id = 'sprites' and public.is_admin());
drop policy if exists sprites_admin_delete on storage.objects;
create policy sprites_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'sprites' and public.is_admin());
