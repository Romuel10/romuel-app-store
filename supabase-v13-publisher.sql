-- ============================================================================
-- ROMUEL APPS V13.3 — CENTRE DE PUBLICATION SUPABASE
-- À exécuter une seule fois dans Supabase > SQL Editor.
-- Le script est idempotent : il peut être relancé sans supprimer les données.
-- ============================================================================

create extension if not exists pgcrypto;

-- --------------------------------------------------------------------------
-- 1. Vérification des droits du compte connecté
-- --------------------------------------------------------------------------
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists access_level text not null default 'public';
update public.profiles set access_level = 'public' where access_level is null;
update public.profiles set access_level = 'gendarme' where access_level = 'gendarmerie';
update public.profiles set access_level = 'public' where access_level not in ('public', 'gendarme');

alter table public.profiles drop constraint if exists profiles_access_level_check;
alter table public.profiles add constraint profiles_access_level_check
  check (access_level in ('public', 'gendarme'));

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_admin = true
  );
$$;

create or replace function public.has_gendarmerie_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (p.is_admin = true or p.access_level = 'gendarme')
  );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.has_gendarmerie_access() from public;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.has_gendarmerie_access() to anon, authenticated;

-- Fonctions utilisées par Admin > Accès Gendarmerie.
create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  display_name text,
  is_admin boolean,
  access_level text
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès administrateur requis';
  end if;

  return query
  select u.id,
         u.email::text,
         coalesce(p.display_name, split_part(u.email, '@', 1))::text,
         coalesce(p.is_admin, false),
         coalesce(p.access_level, 'public')::text
  from auth.users u
  left join public.profiles p on p.id = u.id
  order by coalesce(p.display_name, u.email);
end;
$$;

create or replace function public.set_user_access(target_user uuid, new_access text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès administrateur requis';
  end if;
  if new_access not in ('public', 'gendarme') then
    raise exception 'Niveau d’accès invalide';
  end if;
  if exists (select 1 from public.profiles where id = target_user and is_admin = true) then
    raise exception 'Le niveau d’un administrateur ne peut pas être modifié ici';
  end if;

  update public.profiles
  set access_level = new_access
  where id = target_user;

  if not found then
    raise exception 'Profil utilisateur introuvable';
  end if;
end;
$$;

revoke all on function public.admin_list_users() from public;
revoke all on function public.set_user_access(uuid, text) from public;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.set_user_access(uuid, text) to authenticated;

-- --------------------------------------------------------------------------
-- 2. Applications, versions et captures
-- --------------------------------------------------------------------------
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  version text not null,
  category text not null default 'Autres',
  description text not null,
  changes text[] not null default '{}',
  visibility text not null default 'public',
  status text not null default 'draft',
  icon_path text,
  apk_path text not null,
  download_count bigint not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.applications add column if not exists slug text;
alter table public.applications add column if not exists name text;
alter table public.applications add column if not exists version text;
alter table public.applications add column if not exists category text default 'Autres';
alter table public.applications add column if not exists description text;
alter table public.applications add column if not exists changes text[] default '{}';
alter table public.applications add column if not exists visibility text default 'public';
alter table public.applications add column if not exists status text default 'draft';
alter table public.applications add column if not exists icon_path text;
alter table public.applications add column if not exists apk_path text;
alter table public.applications add column if not exists download_count bigint default 0;
alter table public.applications add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.applications add column if not exists published_at timestamptz;
alter table public.applications add column if not exists created_at timestamptz default now();
alter table public.applications add column if not exists updated_at timestamptz default now();

-- Reprendre automatiquement les noms de colonnes utilisés par certaines
-- versions précédentes du projet.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'applications' and column_name = 'logo_path'
  ) then
    execute 'update public.applications set icon_path = logo_path where icon_path is null';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'applications' and column_name = 'current_version'
  ) then
    execute 'update public.applications set version = current_version where version is null';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'applications' and column_name = 'is_published'
  ) then
    execute 'update public.applications set status = case when is_published then ''published'' else ''draft'' end';
  end if;
end;
$$;

update public.applications set changes = '{}' where changes is null;
update public.applications set download_count = 0 where download_count is null;
update public.applications set visibility = 'public' where visibility is null;
update public.applications set status = 'draft' where status is null;
update public.applications set visibility = 'gendarmerie' where visibility = 'private';
update public.applications set visibility = 'gendarmerie' where visibility not in ('public', 'gendarmerie');
update public.applications set status = 'draft' where status not in ('draft', 'published');
update public.applications set published_at = coalesce(published_at, created_at, now()) where status = 'published';

alter table public.applications drop constraint if exists applications_visibility_check;
alter table public.applications add constraint applications_visibility_check
  check (visibility in ('public', 'gendarmerie'));
alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications add constraint applications_status_check
  check (status in ('draft', 'published'));
alter table public.applications drop constraint if exists applications_download_count_check;
alter table public.applications add constraint applications_download_count_check
  check (download_count >= 0);

create unique index if not exists applications_slug_unique_idx
  on public.applications (slug);
create index if not exists applications_catalog_idx
  on public.applications (visibility, status, published_at desc);

create table if not exists public.app_versions (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.applications(id) on delete cascade,
  version text not null,
  apk_path text not null,
  changes text[] not null default '{}',
  published_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (app_id, version)
);

alter table public.app_versions add column if not exists app_id uuid references public.applications(id) on delete cascade;
alter table public.app_versions add column if not exists version text;
alter table public.app_versions add column if not exists apk_path text;
alter table public.app_versions add column if not exists changes text[] default '{}';
alter table public.app_versions add column if not exists published_at timestamptz default now();
alter table public.app_versions add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.app_versions add column if not exists created_at timestamptz default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.app_versions'::regclass
      and confrelid = 'public.applications'::regclass
      and contype = 'f'
  ) then
    alter table public.app_versions
      add constraint app_versions_app_id_fkey
      foreign key (app_id) references public.applications(id) on delete cascade;
  end if;
end;
$$;

create unique index if not exists app_versions_app_version_unique_idx
  on public.app_versions (app_id, version);

create index if not exists app_versions_app_date_idx
  on public.app_versions (app_id, published_at desc);

create table if not exists public.app_screenshots (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.applications(id) on delete cascade,
  storage_path text not null,
  alt_text text,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.app_screenshots add column if not exists app_id uuid references public.applications(id) on delete cascade;
alter table public.app_screenshots add column if not exists storage_path text;
alter table public.app_screenshots add column if not exists alt_text text;
alter table public.app_screenshots add column if not exists sort_order integer default 0;
alter table public.app_screenshots add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.app_screenshots add column if not exists created_at timestamptz default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.app_screenshots'::regclass
      and confrelid = 'public.applications'::regclass
      and contype = 'f'
  ) then
    alter table public.app_screenshots
      add constraint app_screenshots_app_id_fkey
      foreign key (app_id) references public.applications(id) on delete cascade;
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_screenshots' and column_name = 'image_path'
  ) then
    execute 'update public.app_screenshots set storage_path = image_path where storage_path is null';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_screenshots' and column_name = 'path'
  ) then
    execute 'update public.app_screenshots set storage_path = path where storage_path is null';
  end if;
end;
$$;

create unique index if not exists app_screenshots_path_unique_idx
  on public.app_screenshots (storage_path)
  where storage_path is not null;
create index if not exists app_screenshots_app_order_idx
  on public.app_screenshots (app_id, sort_order);

create or replace function public.set_application_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Un téléchargement incrémente seulement le compteur et ne doit pas faire
  -- apparaître l'application comme une nouvelle mise à jour.
  if (to_jsonb(new) - 'download_count' - 'updated_at')
     is distinct from
     (to_jsonb(old) - 'download_count' - 'updated_at') then
    new.updated_at = now();
  else
    new.updated_at = old.updated_at;
  end if;
  return new;
end;
$$;

drop trigger if exists applications_set_updated_at on public.applications;
create trigger applications_set_updated_at
before update on public.applications
for each row execute function public.set_application_updated_at();

-- Créer l'historique initial pour les applications provenant d'une migration.
insert into public.app_versions (app_id, version, apk_path, changes, published_at, created_by)
select a.id, a.version, a.apk_path, coalesce(a.changes, '{}'),
       coalesce(a.published_at, a.updated_at, a.created_at, now()), a.created_by
from public.applications a
where a.version is not null and a.apk_path is not null
on conflict (app_id, version) do nothing;

-- Cette fonction centralise l'autorisation. Elle est également utilisée par
-- Supabase Storage pour protéger physiquement les fichiers.
create or replace function public.can_access_application(target_app uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or exists (
      select 1
      from public.applications a
      where a.id = target_app
        and a.status = 'published'
        and (
          a.visibility = 'public'
          or (a.visibility = 'gendarmerie' and public.has_gendarmerie_access())
        )
    );
$$;

revoke all on function public.can_access_application(uuid) from public;
grant execute on function public.can_access_application(uuid) to anon, authenticated;

alter table public.applications enable row level security;
alter table public.app_versions enable row level security;
alter table public.app_screenshots enable row level security;

drop policy if exists "Catalogue applications autorisees" on public.applications;
create policy "Catalogue applications autorisees"
on public.applications for select
to anon, authenticated
using (public.can_access_application(id));

drop policy if exists "Admin gere applications" on public.applications;
create policy "Admin gere applications"
on public.applications for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Versions applications autorisees" on public.app_versions;
create policy "Versions applications autorisees"
on public.app_versions for select
to anon, authenticated
using (public.can_access_application(app_id));

drop policy if exists "Admin gere versions" on public.app_versions;
create policy "Admin gere versions"
on public.app_versions for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Captures applications autorisees" on public.app_screenshots;
create policy "Captures applications autorisees"
on public.app_screenshots for select
to anon, authenticated
using (public.can_access_application(app_id));

drop policy if exists "Admin gere captures" on public.app_screenshots;
create policy "Admin gere captures"
on public.app_screenshots for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select on public.applications, public.app_versions, public.app_screenshots to anon, authenticated;
grant insert, update, delete on public.applications, public.app_versions, public.app_screenshots to authenticated;

-- --------------------------------------------------------------------------
-- 3. Buckets privés : APK, logos et captures
-- --------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('app-apk', 'app-apk', false, 524288000, array['application/vnd.android.package-archive','application/octet-stream','application/zip']),
  ('app-icons', 'app-icons', false, 5242880, array['image/png','image/jpeg','image/webp']),
  ('app-screenshots', 'app-screenshots', false, 10485760, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Le premier dossier de chaque objet est toujours l'UUID de l'application.
create or replace function public.storage_application_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = public, storage
as $$
declare
  first_folder text;
begin
  first_folder := (storage.foldername(object_name))[1];
  begin
    return first_folder::uuid;
  exception when invalid_text_representation then
    return null;
  end;
end;
$$;

grant execute on function public.storage_application_id(text) to anon, authenticated;

drop policy if exists "Lire fichiers applications autorisees" on storage.objects;
create policy "Lire fichiers applications autorisees"
on storage.objects for select
to anon, authenticated
using (
  bucket_id in ('app-apk', 'app-icons', 'app-screenshots')
  and public.can_access_application(public.storage_application_id(name))
);

drop policy if exists "Admin gere fichiers applications" on storage.objects;
create policy "Admin gere fichiers applications"
on storage.objects for all
to authenticated
using (
  bucket_id in ('app-apk', 'app-icons', 'app-screenshots')
  and public.is_admin()
)
with check (
  bucket_id in ('app-apk', 'app-icons', 'app-screenshots')
  and public.is_admin()
);

-- --------------------------------------------------------------------------
-- 4. Compteur de téléchargements Supabase
-- --------------------------------------------------------------------------
create or replace function public.increment_application_download_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.applications
  set download_count = download_count + 1
  where slug = new.app_id;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.download_events') is not null then
    execute 'drop trigger if exists increment_application_download_count on public.download_events';
    execute 'create trigger increment_application_download_count
             after insert on public.download_events
             for each row execute function public.increment_application_download_count()';
    execute 'update public.applications a
             set download_count = (
               select count(*) from public.download_events d where d.app_id = a.slug
             )';
  end if;
end;
$$;

notify pgrst, 'reload schema';

-- Fin : le centre de publication peut maintenant être utilisé depuis Admin.
