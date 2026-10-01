-- Mada Apps V15.9 — stockage hybride Supabase + Cloudflare R2

alter table public.applications
  add column if not exists apk_storage_provider text not null default 'supabase',
  add column if not exists icon_storage_provider text not null default 'supabase';

alter table public.app_versions
  add column if not exists storage_provider text not null default 'supabase';

alter table public.app_screenshots
  add column if not exists storage_provider text not null default 'supabase';

alter table public.applications drop constraint if exists applications_apk_storage_provider_chk;
alter table public.applications
  add constraint applications_apk_storage_provider_chk
  check (apk_storage_provider in ('supabase','r2'));

alter table public.applications drop constraint if exists applications_icon_storage_provider_chk;
alter table public.applications
  add constraint applications_icon_storage_provider_chk
  check (icon_storage_provider in ('supabase','r2'));

alter table public.app_versions drop constraint if exists app_versions_storage_provider_chk;
alter table public.app_versions
  add constraint app_versions_storage_provider_chk
  check (storage_provider in ('supabase','r2'));

alter table public.app_screenshots drop constraint if exists app_screenshots_storage_provider_chk;
alter table public.app_screenshots
  add constraint app_screenshots_storage_provider_chk
  check (storage_provider in ('supabase','r2'));

create index if not exists applications_apk_storage_provider_idx
  on public.applications(apk_storage_provider);
create index if not exists app_versions_storage_provider_idx
  on public.app_versions(storage_provider);
create index if not exists app_screenshots_storage_provider_idx
  on public.app_screenshots(storage_provider);

create or replace function private.admin_publish_application_v2(
  p_payload jsonb,
  p_screens jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  v_status text;
  v_visibility text;
  v_changes text[];
  v_apk_provider text;
  v_icon_provider text;
begin
  if not private.is_admin() then raise exception 'Accès administrateur requis'; end if;

  v_id := coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid());
  v_status := coalesce(nullif(p_payload->>'status',''),'published');
  v_visibility := coalesce(nullif(p_payload->>'visibility',''),'public');
  v_apk_provider := coalesce(nullif(p_payload->>'apk_storage_provider',''),'supabase');
  v_icon_provider := coalesce(nullif(p_payload->>'icon_storage_provider',''),'supabase');
  v_changes := coalesce(
    array(select jsonb_array_elements_text(coalesce(p_payload->'changes','[]'::jsonb))),
    '{}'::text[]
  );

  if v_status not in ('draft','published') then raise exception 'Statut invalide'; end if;
  if v_visibility not in ('public','gendarmerie') then raise exception 'Visibilité invalide'; end if;
  if v_apk_provider not in ('supabase','r2') or v_icon_provider not in ('supabase','r2') then
    raise exception 'Fournisseur de stockage invalide';
  end if;

  if nullif(trim(p_payload->>'slug'),'') is null
     or nullif(trim(p_payload->>'name'),'') is null
     or nullif(trim(p_payload->>'version'),'') is null
     or nullif(trim(p_payload->>'description'),'') is null
     or nullif(trim(p_payload->>'apk_path'),'') is null then
    raise exception 'Informations de publication incomplètes';
  end if;

  insert into public.applications(
    id,slug,name,version,category,description,changes,visibility,status,
    icon_path,icon_storage_provider,apk_path,apk_storage_provider,created_by,published_at
  )
  values(
    v_id,trim(p_payload->>'slug'),trim(p_payload->>'name'),trim(p_payload->>'version'),
    coalesce(nullif(trim(p_payload->>'category'),''),'Autres'),
    trim(p_payload->>'description'),v_changes,v_visibility,v_status,
    nullif(p_payload->>'icon_path',''),v_icon_provider,
    p_payload->>'apk_path',v_apk_provider,(select auth.uid()),
    case when v_status='published' then now() else null end
  );

  insert into public.app_versions(
    app_id,version,apk_path,storage_provider,changes,status,published_at,
    created_by,review_note,reviewed_at
  )
  values(
    v_id,trim(p_payload->>'version'),p_payload->>'apk_path',v_apk_provider,
    v_changes,case when v_status='published' then 'published' else 'draft' end,
    now(),(select auth.uid()),null,
    case when v_status='published' then now() else null end
  );

  insert into public.app_screenshots(
    app_id,storage_path,storage_provider,alt_text,sort_order,created_by
  )
  select
    v_id,x.storage_path,coalesce(nullif(x.storage_provider,''),'supabase'),
    coalesce(nullif(x.alt_text,''),'Capture '||(x.sort_order+1)::text),
    x.sort_order,(select auth.uid())
  from jsonb_to_recordset(coalesce(p_screens,'[]'::jsonb))
       as x(storage_path text,storage_provider text,alt_text text,sort_order integer)
  where nullif(x.storage_path,'') is not null;

  return jsonb_build_object('appId',v_id);
end;
$$;

create or replace function private.admin_publish_version_v2(
  p_payload jsonb,
  p_screens jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_app public.applications%rowtype;
  v_app_id uuid := nullif(p_payload->>'app_id','')::uuid;
  v_version text := trim(p_payload->>'version');
  v_apk_path text := p_payload->>'apk_path';
  v_provider text := coalesce(nullif(p_payload->>'storage_provider',''),'supabase');
  v_icon_path text := nullif(p_payload->>'icon_path','');
  v_icon_provider text := coalesce(nullif(p_payload->>'icon_storage_provider',''),'supabase');
  v_changes text[] := coalesce(
    array(select jsonb_array_elements_text(coalesce(p_payload->'changes','[]'::jsonb))),
    '{}'::text[]
  );
  v_old_apk text;
  v_old_apk_provider text;
  v_old_icon text;
  v_old_icon_provider text;
  v_version_id uuid;
begin
  if not private.is_admin() then raise exception 'Accès administrateur requis'; end if;
  if v_provider not in ('supabase','r2') or v_icon_provider not in ('supabase','r2') then
    raise exception 'Fournisseur de stockage invalide';
  end if;

  select * into v_app from public.applications where id=v_app_id for update;
  if not found then raise exception 'Application introuvable'; end if;
  if nullif(v_version,'') is null or nullif(trim(v_apk_path),'') is null then
    raise exception 'Version ou APK invalide';
  end if;

  select apk_path,storage_provider into v_old_apk,v_old_apk_provider
  from public.app_versions where app_id=v_app_id and version=v_version;

  v_old_icon := v_app.icon_path;
  v_old_icon_provider := v_app.icon_storage_provider;

  insert into public.app_versions(
    app_id,version,apk_path,storage_provider,changes,status,published_at,
    created_by,review_note,reviewed_at
  )
  values(
    v_app_id,v_version,v_apk_path,v_provider,v_changes,'published',
    now(),(select auth.uid()),null,now()
  )
  on conflict(app_id,version) do update set
    apk_path=excluded.apk_path,
    storage_provider=excluded.storage_provider,
    changes=excluded.changes,
    status='published',
    published_at=now(),
    review_note=null,
    reviewed_at=now()
  returning id into v_version_id;

  update public.applications
  set version=v_version,
      apk_path=v_apk_path,
      apk_storage_provider=v_provider,
      changes=v_changes,
      icon_path=coalesce(v_icon_path,icon_path),
      icon_storage_provider=case when v_icon_path is not null then v_icon_provider else icon_storage_provider end,
      updated_at=now(),
      published_at=case when status='published' then coalesce(published_at,now()) else published_at end
  where id=v_app_id;

  insert into public.app_screenshots(
    app_id,storage_path,storage_provider,alt_text,sort_order,created_by
  )
  select
    v_app_id,x.storage_path,coalesce(nullif(x.storage_provider,''),'supabase'),
    coalesce(nullif(x.alt_text,''),'Capture '||(x.sort_order+1)::text),
    x.sort_order,(select auth.uid())
  from jsonb_to_recordset(coalesce(p_screens,'[]'::jsonb))
       as x(storage_path text,storage_provider text,alt_text text,sort_order integer)
  where nullif(x.storage_path,'') is not null;

  return jsonb_build_object(
    'versionId',v_version_id,
    'replacedApkPath',case when v_old_apk is distinct from v_apk_path then v_old_apk else null end,
    'replacedApkProvider',case when v_old_apk is distinct from v_apk_path then v_old_apk_provider else null end,
    'replacedIconPath',case when v_icon_path is not null and v_old_icon is distinct from v_icon_path then v_old_icon else null end,
    'replacedIconProvider',case when v_icon_path is not null and v_old_icon is distinct from v_icon_path then v_old_icon_provider else null end
  );
end;
$$;

create or replace function private.admin_edit_application_v2(
  p_payload jsonb,
  p_screens jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_app_id uuid := nullif(p_payload->>'app_id','')::uuid;
  v_app public.applications%rowtype;
  v_icon_path text := nullif(p_payload->>'icon_path','');
  v_icon_provider text := coalesce(nullif(p_payload->>'icon_storage_provider',''),'supabase');
  v_visibility text := p_payload->>'visibility';
  v_status text := p_payload->>'status';
begin
  if not private.is_admin() then raise exception 'Accès administrateur requis'; end if;
  if v_icon_provider not in ('supabase','r2') then raise exception 'Fournisseur de stockage invalide'; end if;
  if v_visibility not in ('public','gendarmerie') then raise exception 'Visibilité invalide'; end if;
  if v_status not in ('draft','published') then raise exception 'Statut invalide'; end if;

  select * into v_app from public.applications where id=v_app_id for update;
  if not found then raise exception 'Application introuvable'; end if;

  update public.applications
  set name=trim(p_payload->>'name'),
      category=coalesce(nullif(trim(p_payload->>'category'),''),'Autres'),
      description=trim(p_payload->>'description'),
      visibility=v_visibility,
      status=v_status,
      icon_path=coalesce(v_icon_path,icon_path),
      icon_storage_provider=case when v_icon_path is not null then v_icon_provider else icon_storage_provider end,
      published_at=case when v_status='published' then coalesce(published_at,now()) else published_at end,
      updated_at=now()
  where id=v_app_id;

  insert into public.app_screenshots(
    app_id,storage_path,storage_provider,alt_text,sort_order,created_by
  )
  select
    v_app_id,x.storage_path,coalesce(nullif(x.storage_provider,''),'supabase'),
    coalesce(nullif(x.alt_text,''),'Capture '||(x.sort_order+1)::text),
    x.sort_order,(select auth.uid())
  from jsonb_to_recordset(coalesce(p_screens,'[]'::jsonb))
       as x(storage_path text,storage_provider text,alt_text text,sort_order integer)
  where nullif(x.storage_path,'') is not null;

  return jsonb_build_object(
    'appId',v_app_id,
    'replacedIconPath',case when v_icon_path is not null and v_app.icon_path is distinct from v_icon_path then v_app.icon_path else null end,
    'replacedIconProvider',case when v_icon_path is not null and v_app.icon_path is distinct from v_icon_path then v_app.icon_storage_provider else null end
  );
end;
$$;

create or replace function private.developer_resubmit_version_v2(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_version_id uuid := nullif(p_payload->>'version_id','')::uuid;
  v_provider text := coalesce(nullif(p_payload->>'storage_provider',''),'supabase');
  v public.app_versions%rowtype;
  v_app public.applications%rowtype;
  v_changes text[] := coalesce(
    array(select jsonb_array_elements_text(coalesce(p_payload->'changes','[]'::jsonb))),
    '{}'::text[]
  );
begin
  if not private.is_developer() then raise exception 'Rôle Développeur requis'; end if;
  if v_provider not in ('supabase','r2') then raise exception 'Fournisseur de stockage invalide'; end if;

  select * into v from public.app_versions
  where id=v_version_id and status='rejected' for update;
  if not found then raise exception 'Version refusée introuvable'; end if;

  select * into v_app from public.applications
  where id=v.app_id and created_by=(select auth.uid())
    and visibility='public' and status='published';
  if not found then raise exception 'Cette version ne peut pas être renvoyée'; end if;

  update public.app_versions
  set apk_path=p_payload->>'apk_path',
      storage_provider=v_provider,
      changes=v_changes,
      status='pending',
      review_note=null,
      submitted_at=now(),
      reviewed_at=null
  where id=v_version_id;

  return jsonb_build_object(
    'versionId',v_version_id,
    'replacedApkPath',case when v.apk_path is distinct from p_payload->>'apk_path' then v.apk_path else null end,
    'replacedApkProvider',case when v.apk_path is distinct from p_payload->>'apk_path' then v.storage_provider else null end
  );
end;
$$;

create or replace function public.admin_publish_application_v2(p_payload jsonb,p_screens jsonb default '[]'::jsonb)
returns jsonb language sql set search_path='' as $$
  select private.admin_publish_application_v2(p_payload,p_screens);
$$;
create or replace function public.admin_publish_version_v2(p_payload jsonb,p_screens jsonb default '[]'::jsonb)
returns jsonb language sql set search_path='' as $$
  select private.admin_publish_version_v2(p_payload,p_screens);
$$;
create or replace function public.admin_edit_application_v2(p_payload jsonb,p_screens jsonb default '[]'::jsonb)
returns jsonb language sql set search_path='' as $$
  select private.admin_edit_application_v2(p_payload,p_screens);
$$;
create or replace function public.developer_resubmit_version_v2(p_payload jsonb)
returns jsonb language sql set search_path='' as $$
  select private.developer_resubmit_version_v2(p_payload);
$$;

revoke all on function private.admin_publish_application_v2(jsonb,jsonb) from public;
revoke all on function private.admin_publish_version_v2(jsonb,jsonb) from public;
revoke all on function private.admin_edit_application_v2(jsonb,jsonb) from public;
revoke all on function private.developer_resubmit_version_v2(jsonb) from public;
grant execute on function private.admin_publish_application_v2(jsonb,jsonb) to authenticated;
grant execute on function private.admin_publish_version_v2(jsonb,jsonb) to authenticated;
grant execute on function private.admin_edit_application_v2(jsonb,jsonb) to authenticated;
grant execute on function private.developer_resubmit_version_v2(jsonb) to authenticated;

revoke all on function public.admin_publish_application_v2(jsonb,jsonb) from public,anon;
revoke all on function public.admin_publish_version_v2(jsonb,jsonb) from public,anon;
revoke all on function public.admin_edit_application_v2(jsonb,jsonb) from public,anon;
revoke all on function public.developer_resubmit_version_v2(jsonb) from public,anon;
grant execute on function public.admin_publish_application_v2(jsonb,jsonb) to authenticated;
grant execute on function public.admin_publish_version_v2(jsonb,jsonb) to authenticated;
grant execute on function public.admin_edit_application_v2(jsonb,jsonb) to authenticated;
grant execute on function public.developer_resubmit_version_v2(jsonb) to authenticated;

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

  select * into v from public.app_versions
  where id=target_version and status='pending' for update;
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
        apk_storage_provider=coalesce(v.storage_provider,'supabase'),
        changes=v.changes,
        status='published',
        review_note=null,
        updated_at=now(),
        published_at=coalesce(published_at,now())
    where id=v.app_id;
  end if;
end;
$$;

notify pgrst,'reload schema';
