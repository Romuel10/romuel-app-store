-- ============================================================================
-- MADA APPS V15 — INSTALLATION / MIGRATION SUPABASE COMPLÈTE
-- À exécuter EN UNE SEULE FOIS dans Supabase > SQL Editor > Run.
-- Idempotent : peut être relancé. Ne supprime pas les applications ni fichiers.
-- ============================================================================
create extension if not exists pgcrypto;

-- 1) PROFILS / RÔLES ---------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  role text not null default 'USER',
  is_admin boolean not null default false,
  access_level text not null default 'public',
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists role text default 'USER';
alter table public.profiles add column if not exists is_admin boolean default false;
alter table public.profiles add column if not exists access_level text default 'public';
alter table public.profiles add column if not exists created_at timestamptz default now();
update public.profiles set role=upper(coalesce(role,'USER'));
update public.profiles set role='GENDARMERIE' where lower(coalesce(access_level,'')) in ('gendarme','gendarmerie') and role='USER';
update public.profiles set role='ADMIN' where is_admin=true;
update public.profiles set role='USER' where role not in ('USER','DEVELOPER','GENDARMERIE','ADMIN');
update public.profiles set access_level='gendarme' where lower(coalesce(access_level,''))='gendarmerie';
update public.profiles set access_level='public' where access_level is null or access_level not in ('public','gendarme');
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check(role in ('USER','DEVELOPER','GENDARMERIE','ADMIN'));
alter table public.profiles drop constraint if exists profiles_access_level_check;
alter table public.profiles add constraint profiles_access_level_check check(access_level in ('public','gendarme'));

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,display_name,role,is_admin,access_level)
  values(new.id,coalesce(new.raw_user_meta_data->>'display_name',split_part(coalesce(new.email,''),'@',1)),'USER',false,'public')
  on conflict(id) do nothing;
  return new;
end;$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.ensure_my_profile(default_display_name text default null) returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  insert into public.profiles(id,display_name) values(auth.uid(),coalesce(nullif(default_display_name,''),'Utilisateur')) on conflict(id) do nothing;
end;$$;
grant execute on function public.ensure_my_profile(text) to authenticated;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and (p.is_admin=true or p.role='ADMIN'));
$$;
create or replace function public.is_developer() returns boolean language sql stable security definer set search_path=public as $$
 select public.is_admin() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='DEVELOPER');
$$;
create or replace function public.has_gendarmerie_access() returns boolean language sql stable security definer set search_path=public as $$
 select public.is_admin() or exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='GENDARMERIE' or p.access_level='gendarme'));
$$;
grant execute on function public.is_admin(),public.is_developer(),public.has_gendarmerie_access() to anon,authenticated;

alter table public.profiles enable row level security;
drop policy if exists "Voir son profil" on public.profiles;
create policy "Voir son profil" on public.profiles for select to authenticated using(auth.uid()=id or public.is_admin());
drop policy if exists "Admin lit profils" on public.profiles;
create policy "Admin lit profils" on public.profiles for select to authenticated using(public.is_admin());
revoke update on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update(display_name,avatar_url) on public.profiles to authenticated;
drop policy if exists "Modifier son profil" on public.profiles;
create policy "Modifier son profil" on public.profiles for update to authenticated using(auth.uid()=id) with check(auth.uid()=id);

-- 2) APPLICATIONS ------------------------------------------------------------
create table if not exists public.applications(
 id uuid primary key default gen_random_uuid(), slug text, name text, version text, category text default 'Autres', description text,
 changes text[] default '{}', visibility text default 'public', status text default 'draft', icon_path text, apk_path text,
 download_count bigint default 0, created_by uuid references auth.users(id) on delete set null, review_note text,
 published_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now()
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
alter table public.applications add column if not exists review_note text;
alter table public.applications add column if not exists published_at timestamptz;
alter table public.applications add column if not exists created_at timestamptz default now();
alter table public.applications add column if not exists updated_at timestamptz default now();
do $$ begin
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='applications' and column_name='developer_id') then execute 'update public.applications set created_by=developer_id where created_by is null'; end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='applications' and column_name='current_version') then execute 'update public.applications set version=current_version where version is null'; end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='applications' and column_name='logo_path') then execute 'update public.applications set icon_path=logo_path where icon_path is null'; end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='applications' and column_name='is_published') then execute 'update public.applications set status=case when is_published then ''published'' else ''draft'' end'; end if;
end $$;
update public.applications set visibility=lower(coalesce(visibility,'public')),status=lower(coalesce(status,'draft'));
update public.applications set visibility='gendarmerie' where visibility='private';
update public.applications set visibility='public' where visibility not in ('public','gendarmerie');
update public.applications set status='draft' where status not in ('draft','pending','published','rejected');
update public.applications set changes='{}' where changes is null;
update public.applications set download_count=0 where download_count is null;
alter table public.applications drop constraint if exists applications_visibility_check;
alter table public.applications add constraint applications_visibility_check check(visibility in ('public','gendarmerie'));
alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications add constraint applications_status_check check(status in ('draft','pending','published','rejected'));
create unique index if not exists applications_slug_unique_idx on public.applications(slug) where slug is not null;
create index if not exists applications_catalog_idx on public.applications(visibility,status,published_at desc);

create table if not exists public.app_versions(
 id uuid primary key default gen_random_uuid(), app_id uuid references public.applications(id) on delete cascade, version text, apk_path text,
 changes text[] default '{}', status text default 'published', review_note text, submitted_at timestamptz default now(), reviewed_at timestamptz,
 published_at timestamptz default now(), created_by uuid references auth.users(id) on delete set null, created_at timestamptz default now()
);
alter table public.app_versions add column if not exists app_id uuid references public.applications(id) on delete cascade;
alter table public.app_versions add column if not exists version text;
alter table public.app_versions add column if not exists apk_path text;
alter table public.app_versions add column if not exists changes text[] default '{}';
alter table public.app_versions add column if not exists status text default 'published';
alter table public.app_versions add column if not exists review_note text;
alter table public.app_versions add column if not exists submitted_at timestamptz default now();
alter table public.app_versions add column if not exists reviewed_at timestamptz;
alter table public.app_versions add column if not exists published_at timestamptz default now();
alter table public.app_versions add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.app_versions add column if not exists created_at timestamptz default now();
do $$ begin
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='app_versions' and column_name='application_id') then execute 'update public.app_versions set app_id=application_id where app_id is null'; end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='app_versions' and column_name='version_name') then execute 'update public.app_versions set version=version_name where version is null'; end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='app_versions' and column_name='apk_url') then execute 'update public.app_versions set apk_path=apk_url where apk_path is null'; end if;
end $$;
update public.app_versions set status=lower(coalesce(status,'published'));
update public.app_versions set status='published' where status not in ('draft','pending','published','rejected');
alter table public.app_versions drop constraint if exists app_versions_status_check;
alter table public.app_versions add constraint app_versions_status_check check(status in ('draft','pending','published','rejected'));
create unique index if not exists app_versions_app_version_unique_idx on public.app_versions(app_id,version) where app_id is not null and version is not null;

create table if not exists public.app_screenshots(
 id uuid primary key default gen_random_uuid(), app_id uuid references public.applications(id) on delete cascade, storage_path text,
 alt_text text, sort_order integer default 0, created_by uuid references auth.users(id) on delete set null, created_at timestamptz default now()
);
alter table public.app_screenshots add column if not exists app_id uuid references public.applications(id) on delete cascade;
alter table public.app_screenshots add column if not exists storage_path text;
alter table public.app_screenshots add column if not exists alt_text text;
alter table public.app_screenshots add column if not exists sort_order integer default 0;
alter table public.app_screenshots add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.app_screenshots add column if not exists created_at timestamptz default now();
do $$ begin
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='app_screenshots' and column_name='application_id') then execute 'update public.app_screenshots set app_id=application_id where app_id is null'; end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='app_screenshots' and column_name='image_path') then execute 'update public.app_screenshots set storage_path=image_path where storage_path is null'; end if;
end $$;
create unique index if not exists app_screenshots_path_unique_idx on public.app_screenshots(storage_path) where storage_path is not null;

create or replace function public.can_access_application(target_app uuid) returns boolean language sql stable security definer set search_path=public as $$
 select public.is_admin()
 or exists(select 1 from public.applications a where a.id=target_app and a.created_by=auth.uid() and public.is_developer())
 or exists(select 1 from public.applications a where a.id=target_app and a.status='published' and (a.visibility='public' or (a.visibility='gendarmerie' and public.has_gendarmerie_access())));
$$;
grant execute on function public.can_access_application(uuid) to anon,authenticated;

alter table public.applications enable row level security;alter table public.app_versions enable row level security;alter table public.app_screenshots enable row level security;
drop policy if exists "Catalogue applications autorisees" on public.applications;
create policy "Catalogue applications autorisees" on public.applications for select to anon,authenticated using(public.can_access_application(id));
drop policy if exists "Admin gere applications" on public.applications;
create policy "Admin gere applications" on public.applications for all to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists "Developpeur cree application" on public.applications;
create policy "Developpeur cree application" on public.applications for insert to authenticated with check(public.is_developer() and created_by=auth.uid() and visibility='public' and status in ('draft','pending'));
drop policy if exists "Developpeur modifie brouillon" on public.applications;
create policy "Developpeur modifie brouillon" on public.applications for update to authenticated using(public.is_developer() and created_by=auth.uid() and status in ('draft','rejected')) with check(created_by=auth.uid() and visibility='public' and status in ('draft','pending','rejected'));
drop policy if exists "Developpeur supprime brouillon" on public.applications;
create policy "Developpeur supprime brouillon" on public.applications for delete to authenticated using(public.is_developer() and created_by=auth.uid() and status in ('draft','rejected','pending'));

drop policy if exists "Versions applications autorisees" on public.app_versions;
create policy "Versions applications autorisees" on public.app_versions for select to anon,authenticated using(public.can_access_application(app_id));
drop policy if exists "Admin gere versions" on public.app_versions;
create policy "Admin gere versions" on public.app_versions for all to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists "Developpeur soumet versions" on public.app_versions;
create policy "Developpeur soumet versions" on public.app_versions for insert to authenticated with check(public.is_developer() and status='pending' and created_by=auth.uid() and exists(select 1 from public.applications a where a.id=app_id and a.created_by=auth.uid() and a.visibility='public'));

drop policy if exists "Captures applications autorisees" on public.app_screenshots;
create policy "Captures applications autorisees" on public.app_screenshots for select to anon,authenticated using(public.can_access_application(app_id));
drop policy if exists "Admin gere captures" on public.app_screenshots;
create policy "Admin gere captures" on public.app_screenshots for all to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists "Developpeur ajoute captures" on public.app_screenshots;
create policy "Developpeur ajoute captures" on public.app_screenshots for insert to authenticated with check(public.is_developer() and created_by=auth.uid() and exists(select 1 from public.applications a where a.id=app_id and a.created_by=auth.uid() and a.visibility='public'));
grant select on public.applications,public.app_versions,public.app_screenshots to anon,authenticated;
grant insert,update,delete on public.applications,public.app_versions,public.app_screenshots to authenticated;

-- 3) VALIDATION ADMIN / RESOUMISSION ----------------------------------------
create or replace function public.admin_review_application(target_app uuid,decision text,review_message text default null) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'Accès administrateur requis'; end if;
 if decision not in ('published','rejected') then raise exception 'Décision invalide'; end if;
 update public.applications set status=decision,review_note=nullif(review_message,''),published_at=case when decision='published' then coalesce(published_at,now()) else published_at end,updated_at=now() where id=target_app;
 if decision='published' then update public.app_versions set status='published',review_note=null,reviewed_at=now(),published_at=coalesce(published_at,now()) where app_id=target_app and status='pending';
 else update public.app_versions set status='rejected',review_note=nullif(review_message,''),reviewed_at=now() where app_id=target_app and status='pending'; end if;
end;$$;
create or replace function public.admin_review_version(target_version uuid,decision text,review_message text default null) returns void language plpgsql security definer set search_path=public as $$
declare v public.app_versions; begin
 if not public.is_admin() then raise exception 'Accès administrateur requis'; end if;
 if decision not in ('published','rejected') then raise exception 'Décision invalide'; end if;
 select * into v from public.app_versions where id=target_version; if not found then raise exception 'Version introuvable'; end if;
 update public.app_versions set status=decision,review_note=nullif(review_message,''),reviewed_at=now(),published_at=case when decision='published' then now() else published_at end where id=target_version;
 if decision='published' then update public.applications set version=v.version,apk_path=v.apk_path,changes=v.changes,status='published',review_note=null,updated_at=now(),published_at=coalesce(published_at,now()) where id=v.app_id; end if;
end;$$;
create or replace function public.developer_resubmit_application(target_app uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_developer() then raise exception 'Rôle Développeur requis'; end if;
 if not exists(select 1 from public.applications where id=target_app and created_by=auth.uid() and visibility='public' and status='rejected') then raise exception 'Application non réutilisable'; end if;
 update public.applications set status='pending',review_note=null,updated_at=now() where id=target_app;
 update public.app_versions set status='pending',review_note=null,submitted_at=now(),reviewed_at=null where app_id=target_app and status='rejected';
end;$$;
grant execute on function public.admin_review_application(uuid,text,text),public.admin_review_version(uuid,text,text),public.developer_resubmit_application(uuid) to authenticated;

-- 4) COMPTES ADMIN -----------------------------------------------------------
drop function if exists public.admin_list_users();
create or replace function public.admin_list_users() returns table(id uuid,email text,display_name text,is_admin boolean,access_level text,role text) language plpgsql security definer set search_path=public,auth as $$
begin
 if not public.is_admin() then raise exception 'Accès administrateur requis'; end if;
 return query select u.id,u.email::text,coalesce(p.display_name,split_part(u.email,'@',1))::text,coalesce(p.is_admin,false),coalesce(p.access_level,'public')::text,coalesce(p.role,'USER')::text from auth.users u left join public.profiles p on p.id=u.id order by coalesce(p.display_name,u.email);
end;$$;
create or replace function public.set_user_access(target_user uuid,new_access text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'Accès administrateur requis'; end if;if new_access not in ('public','gendarme') then raise exception 'Niveau invalide'; end if;
 if exists(select 1 from public.profiles where id=target_user and is_admin=true) then raise exception 'Compte administrateur protégé'; end if;
 update public.profiles set access_level=new_access,role=case when new_access='gendarme' and role='USER' then 'GENDARMERIE' when new_access='public' and role='GENDARMERIE' then 'USER' else role end where id=target_user;
end;$$;
create or replace function public.admin_set_user_role(target_user uuid,new_role text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'Accès administrateur requis'; end if;if new_role not in ('USER','DEVELOPER','GENDARMERIE') then raise exception 'Rôle invalide'; end if;
 if exists(select 1 from public.profiles where id=target_user and is_admin=true) then raise exception 'Compte administrateur protégé'; end if;
 update public.profiles set role=new_role,access_level=case when new_role='GENDARMERIE' then 'gendarme' when role='GENDARMERIE' then 'public' else access_level end where id=target_user;
end;$$;
grant execute on function public.admin_list_users(),public.set_user_access(uuid,text),public.admin_set_user_role(uuid,text) to authenticated;

-- 5) AVIS / FAVORIS / SIGNALEMENTS ------------------------------------------
create table if not exists public.favorites(id bigint generated by default as identity primary key,user_id uuid references auth.users(id) on delete cascade,app_id text,created_at timestamptz default now());
alter table public.favorites add column if not exists app_id text;alter table public.favorites add column if not exists user_id uuid references auth.users(id) on delete cascade;alter table public.favorites add column if not exists created_at timestamptz default now();
create table if not exists public.reviews(id bigint generated by default as identity primary key,app_id text,user_id uuid references auth.users(id) on delete cascade,user_name text,rating integer,comment text,moderation_status text default 'visible',created_at timestamptz default now());
alter table public.reviews add column if not exists app_id text;alter table public.reviews add column if not exists user_name text;alter table public.reviews add column if not exists rating integer;alter table public.reviews add column if not exists comment text;alter table public.reviews add column if not exists moderation_status text default 'visible';alter table public.reviews add column if not exists created_at timestamptz default now();
do $$
declare review_id_type text;
begin
 if to_regclass('public.review_reports') is null then
   select udt_name into review_id_type from information_schema.columns where table_schema='public' and table_name='reviews' and column_name='id';
   if review_id_type='uuid' then
     execute 'create table public.review_reports(id uuid primary key default gen_random_uuid(),review_id uuid references public.reviews(id) on delete cascade,reporter_id uuid references auth.users(id) on delete cascade,reason text,status text default ''pending'',created_at timestamptz default now())';
   else
     execute 'create table public.review_reports(id bigint generated by default as identity primary key,review_id bigint references public.reviews(id) on delete cascade,reporter_id uuid references auth.users(id) on delete cascade,reason text,status text default ''pending'',created_at timestamptz default now())';
   end if;
 end if;
end $$;
alter table public.review_reports add column if not exists reporter_id uuid references auth.users(id) on delete cascade;
alter table public.review_reports add column if not exists reason text;
alter table public.review_reports add column if not exists status text default 'pending';
alter table public.review_reports add column if not exists created_at timestamptz default now();
-- Nettoyage d'éventuels doublons avant les index uniques utilisés par UPSERT.
delete from public.favorites a using public.favorites b where a.ctid<b.ctid and a.user_id=b.user_id and a.app_id=b.app_id and a.user_id is not null and a.app_id is not null;
delete from public.reviews a using public.reviews b where a.ctid<b.ctid and a.user_id=b.user_id and a.app_id=b.app_id and a.user_id is not null and a.app_id is not null;
create unique index if not exists favorites_user_app_unique_idx on public.favorites(user_id,app_id) where user_id is not null and app_id is not null;
create unique index if not exists reviews_user_app_unique_idx on public.reviews(user_id,app_id) where user_id is not null and app_id is not null;
alter table public.favorites enable row level security;alter table public.reviews enable row level security;alter table public.review_reports enable row level security;
drop policy if exists "Gestion favoris" on public.favorites;create policy "Gestion favoris" on public.favorites for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
drop policy if exists "Admin lit favoris" on public.favorites;create policy "Admin lit favoris" on public.favorites for select to authenticated using(public.is_admin());
drop policy if exists "Lire avis" on public.reviews;create policy "Lire avis" on public.reviews for select to anon,authenticated using(coalesce(moderation_status,'visible')<>'hidden' or auth.uid()=user_id or public.is_admin());
drop policy if exists "Créer avis" on public.reviews;create policy "Créer avis" on public.reviews for insert to authenticated with check(auth.uid()=user_id);
drop policy if exists "Modifier son avis" on public.reviews;create policy "Modifier son avis" on public.reviews for update to authenticated using(auth.uid()=user_id or public.is_admin()) with check(auth.uid()=user_id or public.is_admin());
drop policy if exists "Supprimer son avis" on public.reviews;create policy "Supprimer son avis" on public.reviews for delete to authenticated using(auth.uid()=user_id or public.is_admin());
drop policy if exists "Signaler avis" on public.review_reports;create policy "Signaler avis" on public.review_reports for insert to authenticated with check(auth.uid()=reporter_id);
drop policy if exists "Admin gère signalements" on public.review_reports;create policy "Admin gère signalements" on public.review_reports for all to authenticated using(public.is_admin()) with check(public.is_admin());
grant select on public.reviews to anon,authenticated;grant insert,update,delete on public.reviews,public.favorites,public.review_reports to authenticated;grant select on public.favorites,public.review_reports to authenticated;

-- 6) TÉLÉCHARGEMENTS ---------------------------------------------------------
create table if not exists public.download_events(id bigint generated by default as identity primary key,app_id text not null,version text,user_id uuid references auth.users(id) on delete set null,created_at timestamptz not null default now());
alter table public.download_events enable row level security;drop policy if exists "Enregistrer telechargement" on public.download_events;create policy "Enregistrer telechargement" on public.download_events for insert to anon,authenticated with check(user_id is null or auth.uid()=user_id);drop policy if exists "Admin lit telechargements" on public.download_events;create policy "Admin lit telechargements" on public.download_events for select to authenticated using(public.is_admin());grant insert on public.download_events to anon,authenticated;grant select on public.download_events to authenticated;
create index if not exists download_events_app_id_idx on public.download_events(app_id);create index if not exists download_events_created_at_idx on public.download_events(created_at desc);
create or replace function public.increment_application_download_count() returns trigger language plpgsql security definer set search_path=public as $$ begin update public.applications set download_count=coalesce(download_count,0)+1 where slug=new.app_id;return new;end;$$;
drop trigger if exists increment_application_download_count on public.download_events;create trigger increment_application_download_count after insert on public.download_events for each row execute function public.increment_application_download_count();

-- 7) STORAGE -----------------------------------------------------------------
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('avatars','avatars',true,5242880,array['image/png','image/jpeg','image/webp']),
 ('app-apk','app-apk',false,524288000,array['application/vnd.android.package-archive','application/octet-stream','application/zip']),
 ('app-icons','app-icons',false,5242880,array['image/png','image/jpeg','image/webp']),
 ('app-screenshots','app-screenshots',false,10485760,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create or replace function public.storage_application_id(object_name text) returns uuid language plpgsql immutable set search_path=public,storage as $$ declare first_folder text;begin first_folder:=(storage.foldername(object_name))[1];begin return first_folder::uuid;exception when invalid_text_representation then return null;end;end;$$;
grant execute on function public.storage_application_id(text) to anon,authenticated;
drop policy if exists "Avatars publics" on storage.objects;create policy "Avatars publics" on storage.objects for select to public using(bucket_id='avatars');
drop policy if exists "Utilisateur gère avatar" on storage.objects;create policy "Utilisateur gère avatar" on storage.objects for all to authenticated using(bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Lire fichiers applications autorisees" on storage.objects;create policy "Lire fichiers applications autorisees" on storage.objects for select to anon,authenticated using(bucket_id in ('app-apk','app-icons','app-screenshots') and public.can_access_application(public.storage_application_id(name)));
drop policy if exists "Admin gere fichiers applications" on storage.objects;create policy "Admin gere fichiers applications" on storage.objects for all to authenticated using(bucket_id in ('app-apk','app-icons','app-screenshots') and public.is_admin()) with check(bucket_id in ('app-apk','app-icons','app-screenshots') and public.is_admin());
drop policy if exists "Developpeur envoie fichiers" on storage.objects;create policy "Developpeur envoie fichiers" on storage.objects for insert to authenticated with check(bucket_id in ('app-apk','app-icons','app-screenshots') and public.is_developer() and exists(select 1 from public.applications a where a.id=public.storage_application_id(name) and a.created_by=auth.uid() and a.visibility='public'));
drop policy if exists "Developpeur remplace fichiers" on storage.objects;create policy "Developpeur remplace fichiers" on storage.objects for update to authenticated using(bucket_id in ('app-apk','app-icons','app-screenshots') and public.is_developer() and exists(select 1 from public.applications a where a.id=public.storage_application_id(name) and a.created_by=auth.uid() and a.visibility='public')) with check(bucket_id in ('app-apk','app-icons','app-screenshots') and public.is_developer() and exists(select 1 from public.applications a where a.id=public.storage_application_id(name) and a.created_by=auth.uid() and a.visibility='public'));

notify pgrst,'reload schema';
-- FIN. Ensuite recharge https://romuelapps.pages.dev/ après déploiement des fichiers.
