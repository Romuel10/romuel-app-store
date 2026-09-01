-- ============================================================================
-- MADA APPS V14 — RÉPARATION DES CAPTURES V13.3
-- À exécuter dans Supabase > SQL Editor.
-- Ce script ne supprime aucune application ni aucun fichier.
-- ============================================================================

create extension if not exists pgcrypto;

alter table public.app_screenshots
  add column if not exists storage_path text;
alter table public.app_screenshots
  add column if not exists alt_text text;
alter table public.app_screenshots
  add column if not exists sort_order integer default 0;
alter table public.app_screenshots
  add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.app_screenshots
  add column if not exists created_at timestamptz default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'app_screenshots'
      and column_name = 'id'
      and udt_name = 'uuid'
      and column_default is null
  ) then
    alter table public.app_screenshots alter column id set default gen_random_uuid();
  end if;
end;
$$;

-- Une ancienne colonne obligatoire telle que image_path peut empêcher les
-- nouvelles insertions. Le modèle v13.4 utilise storage_path à sa place.
do $$
declare
  legacy_column record;
begin
  for legacy_column in
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'app_screenshots'
      and is_nullable = 'NO'
      and column_name not in (
        'id', 'app_id', 'storage_path', 'alt_text',
        'sort_order', 'created_by', 'created_at'
      )
  loop
    execute format(
      'alter table public.app_screenshots alter column %I drop not null',
      legacy_column.column_name
    );
  end loop;
end;
$$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'app_screenshots'
      and column_name = 'image_path'
  ) then
    execute 'update public.app_screenshots set storage_path = image_path where storage_path is null';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'app_screenshots'
      and column_name = 'path'
  ) then
    execute 'update public.app_screenshots set storage_path = path where storage_path is null';
  end if;
end;
$$;

create unique index if not exists app_screenshots_path_unique_idx
  on public.app_screenshots (storage_path)
  where storage_path is not null;

-- Rattache à leur application toutes les images déjà présentes dans le bucket.
insert into public.app_screenshots (
  app_id,
  storage_path,
  alt_text,
  sort_order,
  created_by
)
select
  a.id,
  o.name,
  'Capture de ' || a.name,
  coalesce((
    select max(existing.sort_order) + 1
    from public.app_screenshots existing
    where existing.app_id = a.id
  ), 0) + (row_number() over (
    partition by a.id
    order by o.created_at, o.name
  ) - 1)::integer,
  a.created_by
from storage.objects o
join public.applications a
  on o.name like a.id::text || '/screens/%'
where o.bucket_id = 'app-screenshots'
  and o.name ~* '\.(png|jpe?g|webp)$'
  and not exists (
    select 1
    from public.app_screenshots s
    where s.storage_path = o.name
  )
on conflict do nothing;

notify pgrst, 'reload schema';

-- Résultat attendu pour Math BAC Mada : 5 lignes.
select
  a.name,
  count(s.id) as captures_rattachees
from public.applications a
left join public.app_screenshots s on s.app_id = a.id
group by a.id, a.name
order by a.name;
