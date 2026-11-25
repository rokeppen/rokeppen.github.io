-- Friday Drinks tower defence: tables, admin check and Row Level Security.
-- Safe to re-run: tables are created if missing and policies are dropped before being recreated.

create table if not exists public.weapons (
  id text primary key,
  name text not null,
  description text not null default '',
  sprite text not null default '',
  cost int not null default 0,
  range real not null default 0,
  damage real not null default 0,
  fire_rate real not null default 0,
  effect text not null default 'none'
    check (effect in ('none', 'slow', 'distract', 'lure', 'splash')),
  effect_strength real not null default 0,
  effect_duration real not null default 0,
  upgrades jsonb not null default '[]'::jsonb
);

create table if not exists public.enemies (
  id text primary key,
  name text not null,
  description text not null default '',
  sprite text not null default '',
  hp real not null default 1,
  speed real not null default 1,
  reward int not null default 0,
  wine_damage int not null default 1
);

create table if not exists public.levels (
  id text primary key,
  name text not null,
  sort_order int default 0,
  published boolean default false,
  cols int not null,
  rows int not null,
  start jsonb not null,
  "end" jsonb not null,
  path jsonb not null default '[]'::jsonb,
  blocked jsonb not null default '[]'::jsonb,
  weapon_ids text[] not null default '{}',
  starting_corks int not null default 0,
  starting_wine int not null default 0,
  waves jsonb not null default '[]'::jsonb
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users on delete cascade
);

-- Explicit table privileges for the API roles (newer projects don't grant these by
-- default). Row Level Security below still decides which rows each role may touch.
grant usage on schema public to anon, authenticated;
grant select on public.weapons, public.enemies, public.levels to anon, authenticated;
grant insert, update, delete on public.weapons, public.enemies, public.levels to authenticated;
grant select on public.admins to authenticated;

-- True when the signed-in user is listed in admins. Security definer so it can read
-- admins regardless of that table's RLS; search_path pinned to avoid hijacking.
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

alter table public.weapons enable row level security;
alter table public.enemies enable row level security;
alter table public.levels  enable row level security;
alter table public.admins  enable row level security;

-- weapons
drop policy if exists "weapons are readable by everyone" on public.weapons;
create policy "weapons are readable by everyone" on public.weapons
  for select to anon, authenticated using (true);
drop policy if exists "admins insert weapons" on public.weapons;
create policy "admins insert weapons" on public.weapons
  for insert to authenticated with check (public.is_admin());
drop policy if exists "admins update weapons" on public.weapons;
create policy "admins update weapons" on public.weapons
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins delete weapons" on public.weapons;
create policy "admins delete weapons" on public.weapons
  for delete to authenticated using (public.is_admin());

-- enemies
drop policy if exists "enemies are readable by everyone" on public.enemies;
create policy "enemies are readable by everyone" on public.enemies
  for select to anon, authenticated using (true);
drop policy if exists "admins insert enemies" on public.enemies;
create policy "admins insert enemies" on public.enemies
  for insert to authenticated with check (public.is_admin());
drop policy if exists "admins update enemies" on public.enemies;
create policy "admins update enemies" on public.enemies
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins delete enemies" on public.enemies;
create policy "admins delete enemies" on public.enemies
  for delete to authenticated using (public.is_admin());

-- levels (unpublished levels are filtered in the app, not hidden by RLS)
drop policy if exists "levels are readable by everyone" on public.levels;
create policy "levels are readable by everyone" on public.levels
  for select to anon, authenticated using (true);
drop policy if exists "admins insert levels" on public.levels;
create policy "admins insert levels" on public.levels
  for insert to authenticated with check (public.is_admin());
drop policy if exists "admins update levels" on public.levels;
create policy "admins update levels" on public.levels
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins delete levels" on public.levels;
create policy "admins delete levels" on public.levels
  for delete to authenticated using (public.is_admin());

-- admins: a user can only see their own row; no write policies (manage via the SQL editor).
drop policy if exists "users see their own admin row" on public.admins;
create policy "users see their own admin row" on public.admins
  for select to authenticated using (user_id = auth.uid());
