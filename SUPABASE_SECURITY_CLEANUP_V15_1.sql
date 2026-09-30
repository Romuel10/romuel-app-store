-- Mada Apps V15.1 — Security & Cleanup
-- Idempotent hardening migration for the existing V15 database.
-- Preserves existing applications, users, reviews and files.

begin;

-- 1) Private authorization helpers -------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.profiles p
    where p.id=(select auth.uid())
      and (p.is_admin=true or p.role='ADMIN')
  );
$$;

create or replace function private.is_developer()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select private.is_admin()
    or exists(
      select 1
      from public.profiles p
      where p.id=(select auth.uid())
        and p.role='DEVELOPER'
    );
$$;

create or replace function private.has_gendarmerie_access()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select private.is_admin()
    or exists(
      select 1
      from public.profiles p
      where p.id=(select auth.uid())
        and (p.role='GENDARMERIE' or p.access_level='gendarme')
    );
$$;

create or replace function private.can_access_application(target_app uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select private.is_admin()
    or exists(
      select 1
      from public.applications a
      where a.id=target_app
        and a.created_by=(select auth.uid())
        and private.is_developer()
    )
    or exists(
      select 1
      from public.applications a
      where a.id=target_app
        and a.status='published'
        and (
          a.visibility='public'
          or (a.visibility='gendarmerie' and private.has_gendarmerie_access())
        )
    );
$$;

revoke all on function private.is_admin() from public;
revoke all on function private.is_developer() from public;
revoke all on function private.has_gendarmerie_access() from public;
revoke all on function private.can_access_application(uuid) from public;
grant execute on function private.is_admin() to anon, authenticated;
grant execute on function private.is_developer() to authenticated;
grant execute on function private.has_gendarmerie_access() to authenticated;
grant execute on function private.can_access_application(uuid) to anon, authenticated;

-- Compatibility wrappers remain callable but are no longer SECURITY DEFINER.
create or replace function public.is_admin()
returns boolean language sql stable security invoker set search_path=''
as $$ select private.is_admin(); $$;

create or replace function public.is_developer()
returns boolean language sql stable security invoker set search_path=''
as $$ select private.is_developer(); $$;

create or replace function public.has_gendarmerie_access()
returns boolean language sql stable security invoker set search_path=''
as $$ select private.has_gendarmerie_access(); $$;

create or replace function public.can_access_application(target_app uuid)
returns boolean language sql stable security invoker set search_path=''
as $$ select private.can_access_application(target_app); $$;

revoke all on function public.is_admin() from public;
revoke all on function public.is_developer() from public;
revoke all on function public.has_gendarmerie_access() from public;
revoke all on function public.can_access_application(uuid) from public;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_developer() to authenticated;
grant execute on function public.has_gendarmerie_access() to authenticated;
grant execute on function public.can_access_application(uuid) to anon, authenticated;

-- 2) Normalize reviews --------------------------------------------------------
update public.reviews
set moderation_status='published'
where moderation_status is null or moderation_status='visible';

alter table public.reviews alter column moderation_status set default 'published';
alter table public.reviews drop constraint if exists reviews_moderation_status_check;
alter table public.reviews
  add constraint reviews_moderation_status_check
  check (moderation_status in ('published','hidden','pending'));

-- 3) Lock down legacy/public tables ------------------------------------------
alter table public.developers enable row level security;
alter table public.app_submissions enable row level security;
alter table public.notifications enable row level security;
alter table public.downloads enable row level security;

revoke all on public.developers from anon, authenticated;
revoke all on public.app_submissions from anon, authenticated;
revoke all on public.notifications from anon, authenticated;
revoke all on public.downloads from anon, authenticated;

grant select,insert,update,delete on public.developers to authenticated;
grant select,insert,update,delete on public.app_submissions to authenticated;
grant select,insert,update,delete on public.notifications to authenticated;
grant select,insert,update,delete on public.downloads to authenticated;

-- 4) Remove all old/duplicated Store policies --------------------------------
do $$
declare r record;
begin
  for r in
    select schemaname,tablename,policyname
    from pg_policies
    where schemaname='public'
      and tablename = any(array[
        'profiles','applications','app_versions','app_screenshots',
        'favorites','reviews','review_reports','download_events',
        'private_apps','developers','app_submissions','notifications','downloads'
      ])
  loop
    execute format('drop policy if exists %I on %I.%I',r.policyname,r.schemaname,r.tablename);
  end loop;
end $$;

-- 5) Canonical RLS policies ---------------------------------------------------
alter table public.profiles enable row level security;
create policy "profiles_select"
on public.profiles for select to authenticated
using ((select auth.uid())=id or private.is_admin());

create policy "profiles_insert"
on public.profiles for insert to authenticated
with check ((select auth.uid())=id);

create policy "profiles_update"
on public.profiles for update to authenticated
using ((select auth.uid())=id)
with check ((select auth.uid())=id);

-- Keep role/admin fields immutable from normal client updates.
revoke update on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant insert(id,display_name) on public.profiles to authenticated;
grant update(display_name,avatar_url) on public.profiles to authenticated;

alter table public.applications enable row level security;
create policy "applications_select"
on public.applications for select to anon,authenticated
using (private.can_access_application(id));

create policy "applications_insert"
on public.applications for insert to authenticated
with check (
  private.is_admin()
  or (
    private.is_developer()
    and created_by=(select auth.uid())
    and visibility='public'
    and status='draft'
  )
);

create policy "applications_update"
on public.applications for update to authenticated
using (
  private.is_admin()
  or (
    private.is_developer()
    and created_by=(select auth.uid())
    and status in ('draft','rejected')
  )
)
with check (
  private.is_admin()
  or (
    private.is_developer()
    and created_by=(select auth.uid())
    and visibility='public'
    and status in ('draft','pending','rejected')
  )
);

create policy "applications_delete"
on public.applications for delete to authenticated
using (
  private.is_admin()
  or (
    private.is_developer()
    and created_by=(select auth.uid())
    and status in ('draft','pending','rejected')
  )
);

alter table public.app_versions enable row level security;
create policy "app_versions_select"
on public.app_versions for select to anon,authenticated
using (private.can_access_application(app_id));

create policy "app_versions_insert"
on public.app_versions for insert to authenticated
with check (
  private.is_admin()
  or (
    private.is_developer()
    and status='pending'
    and created_by=(select auth.uid())
    and exists(
      select 1 from public.applications a
      where a.id=app_id
        and a.created_by=(select auth.uid())
        and a.visibility='public'
    )
  )
);

create policy "app_versions_update"
on public.app_versions for update to authenticated
using (private.is_admin())
with check (private.is_admin());

create policy "app_versions_delete"
on public.app_versions for delete to authenticated
using (
  private.is_admin()
  or (
    private.is_developer()
    and created_by=(select auth.uid())
    and status in ('pending','rejected')
    and exists(
      select 1 from public.applications a
      where a.id=app_id
        and a.created_by=(select auth.uid())
        and a.visibility='public'
        and a.status in ('draft','pending','rejected')
    )
  )
);

alter table public.app_screenshots enable row level security;
create policy "app_screenshots_select"
on public.app_screenshots for select to anon,authenticated
using (private.can_access_application(app_id));

create policy "app_screenshots_insert"
on public.app_screenshots for insert to authenticated
with check (
  private.is_admin()
  or (
    private.is_developer()
    and created_by=(select auth.uid())
    and exists(
      select 1 from public.applications a
      where a.id=app_id
        and a.created_by=(select auth.uid())
        and a.visibility='public'
    )
  )
);

create policy "app_screenshots_update"
on public.app_screenshots for update to authenticated
using (private.is_admin())
with check (private.is_admin());

create policy "app_screenshots_delete"
on public.app_screenshots for delete to authenticated
using (
  private.is_admin()
  or (
    private.is_developer()
    and created_by=(select auth.uid())
    and exists(
      select 1 from public.applications a
      where a.id=app_id
        and a.created_by=(select auth.uid())
        and a.visibility='public'
        and a.status in ('draft','pending','rejected')
    )
  )
);

alter table public.favorites enable row level security;
create policy "favorites_select"
on public.favorites for select to authenticated
using ((select auth.uid())=user_id or private.is_admin());

create policy "favorites_insert"
on public.favorites for insert to authenticated
with check ((select auth.uid())=user_id);

create policy "favorites_update"
on public.favorites for update to authenticated
using ((select auth.uid())=user_id)
with check ((select auth.uid())=user_id);

create policy "favorites_delete"
on public.favorites for delete to authenticated
using ((select auth.uid())=user_id);

alter table public.reviews enable row level security;
create policy "reviews_select"
on public.reviews for select to anon,authenticated
using (
  moderation_status='published'
  or (select auth.uid())=user_id
  or private.is_admin()
);

create policy "reviews_insert"
on public.reviews for insert to authenticated
with check (
  (select auth.uid())=user_id
  and moderation_status='published'
);

create policy "reviews_update"
on public.reviews for update to authenticated
using (
  private.is_admin()
  or ((select auth.uid())=user_id and moderation_status='published')
)
with check (
  private.is_admin()
  or ((select auth.uid())=user_id and moderation_status='published')
);

create policy "reviews_delete"
on public.reviews for delete to authenticated
using ((select auth.uid())=user_id or private.is_admin());

alter table public.review_reports enable row level security;
create policy "review_reports_select"
on public.review_reports for select to authenticated
using ((select auth.uid())=reporter_id or private.is_admin());

create policy "review_reports_insert"
on public.review_reports for insert to authenticated
with check ((select auth.uid())=reporter_id);

create policy "review_reports_update"
on public.review_reports for update to authenticated
using (private.is_admin())
with check (private.is_admin());

create policy "review_reports_delete"
on public.review_reports for delete to authenticated
using (private.is_admin());

alter table public.download_events enable row level security;
create policy "download_events_insert"
on public.download_events for insert to anon,authenticated
with check (
  (user_id is null or (select auth.uid())=user_id)
  and exists(
    select 1
    from public.applications a
    where a.slug=app_id
      and a.status='published'
      and (
        a.visibility='public'
        or (a.visibility='gendarmerie' and private.has_gendarmerie_access())
      )
  )
);

create policy "download_events_select"
on public.download_events for select to authenticated
using (private.is_admin());

alter table public.private_apps enable row level security;
create policy "private_apps_select"
on public.private_apps for select to authenticated
using (private.has_gendarmerie_access());

create policy "private_apps_insert"
on public.private_apps for insert to authenticated
with check (private.is_admin());

create policy "private_apps_update"
on public.private_apps for update to authenticated
using (private.is_admin())
with check (private.is_admin());

create policy "private_apps_delete"
on public.private_apps for delete to authenticated
using (private.is_admin());

create policy "developers_admin_only"
on public.developers for all to authenticated
using (private.is_admin()) with check (private.is_admin());

create policy "app_submissions_admin_only"
on public.app_submissions for all to authenticated
using (private.is_admin()) with check (private.is_admin());

create policy "notifications_admin_only"
on public.notifications for all to authenticated
using (private.is_admin()) with check (private.is_admin());

create policy "downloads_admin_only"
on public.downloads for all to authenticated
using (private.is_admin()) with check (private.is_admin());

-- 6) Harden privileged RPCs ---------------------------------------------------
create or replace function public.ensure_my_profile(default_display_name text default null)
returns void
language plpgsql
security invoker
set search_path=''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Connexion requise';
  end if;
  insert into public.profiles(id,display_name)
  values((select auth.uid()),coalesce(nullif(default_display_name,''),'Utilisateur'))
  on conflict(id) do nothing;
end;
$$;

create or replace function public.admin_review_application(
  target_app uuid,
  decision text,
  review_message text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if not private.is_admin() then raise exception 'Accès administrateur requis'; end if;
  if decision not in ('published','rejected') then raise exception 'Décision invalide'; end if;
  if not exists(select 1 from public.applications where id=target_app and status='pending') then
    raise exception 'Application non disponible pour validation';
  end if;

  update public.applications
  set status=decision,
      review_note=nullif(review_message,''),
      published_at=case when decision='published' then coalesce(published_at,now()) else published_at end,
      updated_at=now()
  where id=target_app;

  if decision='published' then
    update public.app_versions
    set status='published',review_note=null,reviewed_at=now(),published_at=coalesce(published_at,now())
    where app_id=target_app and status='pending';
  else
    update public.app_versions
    set status='rejected',review_note=nullif(review_message,''),reviewed_at=now()
    where app_id=target_app and status='pending';
  end if;
end;
$$;

create or replace function public.admin_review_version(
  target_version uuid,
  decision text,
  review_message text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare v public.app_versions;
begin
  if not private.is_admin() then raise exception 'Accès administrateur requis'; end if;
  if decision not in ('published','rejected') then raise exception 'Décision invalide'; end if;

  select * into v
  from public.app_versions
  where id=target_version and status='pending'
  for update;

  if not found then raise exception 'Version non disponible pour validation'; end if;

  update public.app_versions
  set status=decision,
      review_note=nullif(review_message,''),
      reviewed_at=now(),
      published_at=case when decision='published' then now() else published_at end
  where id=target_version;

  if decision='published' then
    update public.applications
    set version=v.version,
        apk_path=v.apk_path,
        changes=v.changes,
        status='published',
        review_note=null,
        updated_at=now(),
        published_at=coalesce(published_at,now())
    where id=v.app_id;
  end if;
end;
$$;

create or replace function public.developer_resubmit_application(target_app uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if not private.is_developer() then raise exception 'Rôle Développeur requis'; end if;
  if not exists(
    select 1 from public.applications
    where id=target_app
      and created_by=(select auth.uid())
      and visibility='public'
      and status='rejected'
  ) then
    raise exception 'Application non réutilisable';
  end if;

  update public.applications
  set status='pending',review_note=null,updated_at=now()
  where id=target_app;

  update public.app_versions
  set status='pending',review_note=null,submitted_at=now(),reviewed_at=null
  where app_id=target_app and status='rejected';
end;
$$;

create or replace function public.admin_list_users()
returns table(id uuid,email text,display_name text,is_admin boolean,access_level text,role text)
language plpgsql
security definer
set search_path=''
as $$
begin
  if not private.is_admin() then raise exception 'Accès administrateur requis'; end if;
  return query
  select u.id,
         u.email::text,
         coalesce(p.display_name,split_part(u.email,'@',1))::text,
         coalesce(p.is_admin,false),
         coalesce(p.access_level,'public')::text,
         coalesce(p.role,'USER')::text
  from auth.users u
  left join public.profiles p on p.id=u.id
  order by coalesce(p.display_name,u.email);
end;
$$;

create or replace function public.set_user_access(target_user uuid,new_access text)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if not private.is_admin() then raise exception 'Accès administrateur requis'; end if;
  if new_access not in ('public','gendarme') then raise exception 'Niveau invalide'; end if;
  if exists(select 1 from public.profiles where id=target_user and is_admin=true) then
    raise exception 'Compte administrateur protégé';
  end if;

  update public.profiles
  set access_level=new_access,
      role=case
        when new_access='gendarme' and role='USER' then 'GENDARMERIE'
        when new_access='public' and role='GENDARMERIE' then 'USER'
        else role
      end
  where id=target_user;
end;
$$;

create or replace function public.admin_set_user_role(target_user uuid,new_role text)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if not private.is_admin() then raise exception 'Accès administrateur requis'; end if;
  if new_role not in ('USER','DEVELOPER','GENDARMERIE') then raise exception 'Rôle invalide'; end if;
  if exists(select 1 from public.profiles where id=target_user and is_admin=true) then
    raise exception 'Compte administrateur protégé';
  end if;

  update public.profiles
  set role=new_role,
      access_level=case
        when new_role='GENDARMERIE' then 'gendarme'
        when role='GENDARMERIE' then 'public'
        else access_level
      end
  where id=target_user;
end;
$$;

-- SECURITY DEFINER RPCs are authenticated-only; triggers are not RPC endpoints.
revoke all on function public.admin_review_application(uuid,text,text) from public, anon;
revoke all on function public.admin_review_version(uuid,text,text) from public, anon;
revoke all on function public.developer_resubmit_application(uuid) from public, anon;
revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.set_user_access(uuid,text) from public, anon;
revoke all on function public.admin_set_user_role(uuid,text) from public, anon;

grant execute on function public.admin_review_application(uuid,text,text) to authenticated;
grant execute on function public.admin_review_version(uuid,text,text) to authenticated;
grant execute on function public.developer_resubmit_application(uuid) to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.set_user_access(uuid,text) to authenticated;
grant execute on function public.admin_set_user_role(uuid,text) to authenticated;
grant execute on function public.ensure_my_profile(text) to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.increment_application_download_count() from public, anon, authenticated;

-- 7) Storage policies: immutable published APKs --------------------------------
-- Remove Store-related legacy policies only; unrelated project policies remain.
drop policy if exists "Admin ajoute fichiers prives" on storage.objects;
drop policy if exists "Admin modifie fichiers prives" on storage.objects;
drop policy if exists "Admin supprime fichiers prives" on storage.objects;
drop policy if exists "Gendarmerie lit fichiers prives" on storage.objects;
drop policy if exists "Admin gere fichiers applications" on storage.objects;
drop policy if exists "Lire fichiers applications autorisees" on storage.objects;
drop policy if exists "Developpeur envoie fichiers" on storage.objects;
drop policy if exists "Developpeur remplace fichiers" on storage.objects;
drop policy if exists "Avatars publics" on storage.objects;
drop policy if exists "Avatars visibles par tous" on storage.objects;
drop policy if exists "Utilisateur gère avatar" on storage.objects;
drop policy if exists "Ajouter son avatar" on storage.objects;
drop policy if exists "Modifier son avatar" on storage.objects;
drop policy if exists "Supprimer son avatar" on storage.objects;

create policy "avatars_select"
on storage.objects for select to public
using (bucket_id='avatars');

create policy "avatars_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id='avatars'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

create policy "avatars_update"
on storage.objects for update to authenticated
using (
  bucket_id='avatars'
  and (storage.foldername(name))[1]=(select auth.uid())::text
)
with check (
  bucket_id='avatars'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

create policy "avatars_delete"
on storage.objects for delete to authenticated
using (
  bucket_id='avatars'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

create policy "app_files_select"
on storage.objects for select to anon,authenticated
using (
  bucket_id in ('app-apk','app-icons','app-screenshots')
  and private.can_access_application(public.storage_application_id(storage.objects.name))
);

create policy "app_files_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id in ('app-apk','app-icons','app-screenshots')
  and (
    private.is_admin()
    or (
      private.is_developer()
      and exists(
        select 1
        from public.applications a
        where a.id=public.storage_application_id(storage.objects.name)
          and a.created_by=(select auth.uid())
          and a.visibility='public'
      )
    )
  )
);

-- Only admins can overwrite an existing application file.
create policy "app_files_update"
on storage.objects for update to authenticated
using (
  bucket_id in ('app-apk','app-icons','app-screenshots')
  and private.is_admin()
)
with check (
  bucket_id in ('app-apk','app-icons','app-screenshots')
  and private.is_admin()
);

-- Developers may only clean up their own unreferenced/orphaned objects.
create policy "app_files_delete"
on storage.objects for delete to authenticated
using (
  bucket_id in ('app-apk','app-icons','app-screenshots')
  and (
    private.is_admin()
    or (
      private.is_developer()
      and exists(
        select 1
        from public.applications a
        where a.id=public.storage_application_id(storage.objects.name)
          and a.created_by=(select auth.uid())
          and a.visibility='public'
      )
      and not exists(
        select 1 from public.applications a2
        where a2.apk_path=storage.objects.name or a2.icon_path=storage.objects.name
      )
      and not exists(
        select 1 from public.app_versions v
        where v.apk_path=storage.objects.name
      )
      and not exists(
        select 1 from public.app_screenshots s
        where s.storage_path=storage.objects.name
      )
    )
  )
);

create policy "legacy_gendarmerie_files_select"
on storage.objects for select to authenticated
using (
  bucket_id='gendarmerie-apps'
  and private.has_gendarmerie_access()
);

create policy "legacy_gendarmerie_files_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id='gendarmerie-apps'
  and private.is_admin()
);

create policy "legacy_gendarmerie_files_update"
on storage.objects for update to authenticated
using (
  bucket_id='gendarmerie-apps'
  and private.is_admin()
)
with check (
  bucket_id='gendarmerie-apps'
  and private.is_admin()
);

create policy "legacy_gendarmerie_files_delete"
on storage.objects for delete to authenticated
using (
  bucket_id='gendarmerie-apps'
  and private.is_admin()
);

-- 8) Remove the known duplicate index ----------------------------------------
drop index if exists public.app_versions_app_version_unique_idx;

notify pgrst,'reload schema';

commit;
