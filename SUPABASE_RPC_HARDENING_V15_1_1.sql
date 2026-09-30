-- Mada Apps V15.1.1 — move privileged implementations outside the exposed API schema.
begin;

create or replace function private.admin_review_application(
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

create or replace function private.admin_review_version(
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

create or replace function private.developer_resubmit_application(target_app uuid)
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

create or replace function private.admin_list_users()
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

create or replace function private.set_user_access(target_user uuid,new_access text)
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

create or replace function private.admin_set_user_role(target_user uuid,new_role text)
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

revoke all on function private.admin_review_application(uuid,text,text) from public;
revoke all on function private.admin_review_version(uuid,text,text) from public;
revoke all on function private.developer_resubmit_application(uuid) from public;
revoke all on function private.admin_list_users() from public;
revoke all on function private.set_user_access(uuid,text) from public;
revoke all on function private.admin_set_user_role(uuid,text) from public;

grant execute on function private.admin_review_application(uuid,text,text) to authenticated;
grant execute on function private.admin_review_version(uuid,text,text) to authenticated;
grant execute on function private.developer_resubmit_application(uuid) to authenticated;
grant execute on function private.admin_list_users() to authenticated;
grant execute on function private.set_user_access(uuid,text) to authenticated;
grant execute on function private.admin_set_user_role(uuid,text) to authenticated;

create or replace function public.admin_review_application(target_app uuid,decision text,review_message text default null)
returns void language sql security invoker set search_path=''
as $$ select private.admin_review_application(target_app,decision,review_message); $$;

create or replace function public.admin_review_version(target_version uuid,decision text,review_message text default null)
returns void language sql security invoker set search_path=''
as $$ select private.admin_review_version(target_version,decision,review_message); $$;

create or replace function public.developer_resubmit_application(target_app uuid)
returns void language sql security invoker set search_path=''
as $$ select private.developer_resubmit_application(target_app); $$;

create or replace function public.admin_list_users()
returns table(id uuid,email text,display_name text,is_admin boolean,access_level text,role text)
language sql security invoker set search_path=''
as $$ select * from private.admin_list_users(); $$;

create or replace function public.set_user_access(target_user uuid,new_access text)
returns void language sql security invoker set search_path=''
as $$ select private.set_user_access(target_user,new_access); $$;

create or replace function public.admin_set_user_role(target_user uuid,new_role text)
returns void language sql security invoker set search_path=''
as $$ select private.admin_set_user_role(target_user,new_role); $$;

revoke all on function public.admin_review_application(uuid,text,text) from public,anon;
revoke all on function public.admin_review_version(uuid,text,text) from public,anon;
revoke all on function public.developer_resubmit_application(uuid) from public,anon;
revoke all on function public.admin_list_users() from public,anon;
revoke all on function public.set_user_access(uuid,text) from public,anon;
revoke all on function public.admin_set_user_role(uuid,text) from public,anon;

grant execute on function public.admin_review_application(uuid,text,text) to authenticated;
grant execute on function public.admin_review_version(uuid,text,text) to authenticated;
grant execute on function public.developer_resubmit_application(uuid) to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.set_user_access(uuid,text) to authenticated;
grant execute on function public.admin_set_user_role(uuid,text) to authenticated;

-- Cover the Store foreign keys reported by the Supabase performance advisor.
create index if not exists applications_created_by_idx on public.applications(created_by);
create index if not exists app_versions_created_by_idx on public.app_versions(created_by);
create index if not exists app_screenshots_created_by_idx on public.app_screenshots(created_by);
create index if not exists download_events_user_id_idx on public.download_events(user_id);
create index if not exists private_apps_created_by_idx on public.private_apps(created_by);
create index if not exists review_reports_reporter_id_idx on public.review_reports(reporter_id);

notify pgrst,'reload schema';
commit;
