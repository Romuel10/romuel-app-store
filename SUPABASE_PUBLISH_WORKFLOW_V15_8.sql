-- Mada Apps V15.8
-- Publication et mise à jour atomiques + renvoi d'une version développeur refusée.

create or replace function private.admin_publish_application(
  p_payload jsonb,
  p_screens jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_visibility text;
  v_changes text[];
begin
  if not private.is_admin() then
    raise exception 'Accès administrateur requis';
  end if;

  v_id := coalesce(nullif(p_payload->>'id','')::uuid, gen_random_uuid());
  v_status := coalesce(nullif(p_payload->>'status',''),'published');
  v_visibility := coalesce(nullif(p_payload->>'visibility',''),'public');
  v_changes := coalesce(
    array(select jsonb_array_elements_text(coalesce(p_payload->'changes','[]'::jsonb))),
    '{}'::text[]
  );

  if v_status not in ('draft','published') then
    raise exception 'Statut invalide';
  end if;
  if v_visibility not in ('public','gendarmerie') then
    raise exception 'Visibilité invalide';
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
    icon_path,apk_path,created_by,published_at
  )
  values(
    v_id,
    trim(p_payload->>'slug'),
    trim(p_payload->>'name'),
    trim(p_payload->>'version'),
    coalesce(nullif(trim(p_payload->>'category'),''),'Autres'),
    trim(p_payload->>'description'),
    v_changes,
    v_visibility,
    v_status,
    nullif(p_payload->>'icon_path',''),
    p_payload->>'apk_path',
    (select auth.uid()),
    case when v_status='published' then now() else null end
  );

  insert into public.app_versions(
    app_id,version,apk_path,changes,status,published_at,created_by,review_note,reviewed_at
  )
  values(
    v_id,
    trim(p_payload->>'version'),
    p_payload->>'apk_path',
    v_changes,
    case when v_status='published' then 'published' else 'draft' end,
    now(),
    (select auth.uid()),
    null,
    case when v_status='published' then now() else null end
  );

  insert into public.app_screenshots(
    app_id,storage_path,alt_text,sort_order,created_by
  )
  select
    v_id,
    x.storage_path,
    coalesce(nullif(x.alt_text,''),'Capture ' || (x.sort_order + 1)::text),
    x.sort_order,
    (select auth.uid())
  from jsonb_to_recordset(coalesce(p_screens,'[]'::jsonb))
       as x(storage_path text,alt_text text,sort_order integer)
  where nullif(x.storage_path,'') is not null;

  return jsonb_build_object('appId',v_id);
end;
$$;

create or replace function private.admin_publish_version(
  target_app uuid,
  new_version text,
  new_apk_path text,
  new_changes text[] default '{}'::text[],
  new_icon_path text default null,
  new_screens jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_version_id uuid;
  v_old_apk text;
  v_old_icon text;
begin
  if not private.is_admin() then
    raise exception 'Accès administrateur requis';
  end if;

  select * into v_app
  from public.applications
  where id=target_app
  for update;

  if not found then
    raise exception 'Application introuvable';
  end if;

  if nullif(trim(new_version),'') is null or nullif(trim(new_apk_path),'') is null then
    raise exception 'Version ou APK invalide';
  end if;

  select apk_path into v_old_apk
  from public.app_versions
  where app_id=target_app and version=trim(new_version);

  v_old_icon := v_app.icon_path;

  insert into public.app_versions(
    app_id,version,apk_path,changes,status,published_at,created_by,review_note,reviewed_at
  )
  values(
    target_app,trim(new_version),new_apk_path,coalesce(new_changes,'{}'::text[]),
    'published',now(),(select auth.uid()),null,now()
  )
  on conflict(app_id,version)
  do update set
    apk_path=excluded.apk_path,
    changes=excluded.changes,
    status='published',
    published_at=now(),
    review_note=null,
    reviewed_at=now()
  returning id into v_version_id;

  update public.applications
  set version=trim(new_version),
      apk_path=new_apk_path,
      changes=coalesce(new_changes,'{}'::text[]),
      icon_path=coalesce(nullif(new_icon_path,''),icon_path),
      updated_at=now(),
      published_at=case when status='published' then coalesce(published_at,now()) else published_at end
  where id=target_app;

  insert into public.app_screenshots(
    app_id,storage_path,alt_text,sort_order,created_by
  )
  select
    target_app,
    x.storage_path,
    coalesce(nullif(x.alt_text,''),'Capture ' || (x.sort_order + 1)::text),
    x.sort_order,
    (select auth.uid())
  from jsonb_to_recordset(coalesce(new_screens,'[]'::jsonb))
       as x(storage_path text,alt_text text,sort_order integer)
  where nullif(x.storage_path,'') is not null;

  return jsonb_build_object(
    'versionId',v_version_id,
    'replacedApkPath',
      case when v_old_apk is distinct from new_apk_path then v_old_apk else null end,
    'replacedIconPath',
      case
        when nullif(new_icon_path,'') is not null and v_old_icon is distinct from new_icon_path
        then v_old_icon
        else null
      end
  );
end;
$$;

create or replace function private.admin_edit_application(
  target_app uuid,
  new_name text,
  new_category text,
  new_description text,
  new_visibility text,
  new_status text,
  new_icon_path text default null,
  new_screens jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
begin
  if not private.is_admin() then
    raise exception 'Accès administrateur requis';
  end if;

  if new_visibility not in ('public','gendarmerie') then
    raise exception 'Visibilité invalide';
  end if;
  if new_status not in ('draft','published') then
    raise exception 'Statut invalide';
  end if;
  if nullif(trim(new_name),'') is null or nullif(trim(new_description),'') is null then
    raise exception 'Nom ou description manquant';
  end if;

  select * into v_app
  from public.applications
  where id=target_app
  for update;

  if not found then
    raise exception 'Application introuvable';
  end if;

  update public.applications
  set name=trim(new_name),
      category=coalesce(nullif(trim(new_category),''),'Autres'),
      description=trim(new_description),
      visibility=new_visibility,
      status=new_status,
      icon_path=coalesce(nullif(new_icon_path,''),icon_path),
      published_at=case
        when new_status='published' then coalesce(published_at,now())
        else published_at
      end,
      updated_at=now()
  where id=target_app;

  insert into public.app_screenshots(
    app_id,storage_path,alt_text,sort_order,created_by
  )
  select
    target_app,
    x.storage_path,
    coalesce(nullif(x.alt_text,''),'Capture ' || (x.sort_order + 1)::text),
    x.sort_order,
    (select auth.uid())
  from jsonb_to_recordset(coalesce(new_screens,'[]'::jsonb))
       as x(storage_path text,alt_text text,sort_order integer)
  where nullif(x.storage_path,'') is not null;

  return jsonb_build_object(
    'appId',target_app,
    'replacedIconPath',
      case
        when nullif(new_icon_path,'') is not null and v_app.icon_path is distinct from new_icon_path
        then v_app.icon_path
        else null
      end
  );
end;
$$;

create or replace function private.developer_resubmit_version(
  target_version uuid,
  new_apk_path text,
  new_changes text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.app_versions%rowtype;
  v_app public.applications%rowtype;
begin
  if not private.is_developer() then
    raise exception 'Rôle Développeur requis';
  end if;

  select * into v
  from public.app_versions
  where id=target_version and status='rejected'
  for update;

  if not found then
    raise exception 'Version refusée introuvable';
  end if;

  select * into v_app
  from public.applications
  where id=v.app_id
    and created_by=(select auth.uid())
    and visibility='public'
    and status='published';

  if not found then
    raise exception 'Cette version ne peut pas être renvoyée';
  end if;

  if nullif(trim(new_apk_path),'') is null then
    raise exception 'APK invalide';
  end if;

  update public.app_versions
  set apk_path=new_apk_path,
      changes=coalesce(new_changes,'{}'::text[]),
      status='pending',
      review_note=null,
      submitted_at=now(),
      reviewed_at=null
  where id=target_version;

  return jsonb_build_object(
    'versionId',target_version,
    'replacedApkPath',
      case when v.apk_path is distinct from new_apk_path then v.apk_path else null end
  );
end;
$$;

create or replace function public.admin_publish_application(
  p_payload jsonb,
  p_screens jsonb default '[]'::jsonb
)
returns jsonb
language sql
set search_path = ''
as $$ select private.admin_publish_application(p_payload,p_screens); $$;

create or replace function public.admin_publish_version(
  target_app uuid,
  new_version text,
  new_apk_path text,
  new_changes text[] default '{}'::text[],
  new_icon_path text default null,
  new_screens jsonb default '[]'::jsonb
)
returns jsonb
language sql
set search_path = ''
as $$ select private.admin_publish_version(target_app,new_version,new_apk_path,new_changes,new_icon_path,new_screens); $$;

create or replace function public.admin_edit_application(
  target_app uuid,
  new_name text,
  new_category text,
  new_description text,
  new_visibility text,
  new_status text,
  new_icon_path text default null,
  new_screens jsonb default '[]'::jsonb
)
returns jsonb
language sql
set search_path = ''
as $$ select private.admin_edit_application(target_app,new_name,new_category,new_description,new_visibility,new_status,new_icon_path,new_screens); $$;

create or replace function public.developer_resubmit_version(
  target_version uuid,
  new_apk_path text,
  new_changes text[] default '{}'::text[]
)
returns jsonb
language sql
set search_path = ''
as $$ select private.developer_resubmit_version(target_version,new_apk_path,new_changes); $$;

revoke all on function public.admin_publish_application(jsonb,jsonb) from public;
revoke all on function public.admin_publish_version(uuid,text,text,text[],text,jsonb) from public;
revoke all on function public.admin_edit_application(uuid,text,text,text,text,text,text,jsonb) from public;
revoke all on function public.developer_resubmit_version(uuid,text,text[]) from public;

grant execute on function public.admin_publish_application(jsonb,jsonb) to authenticated;
grant execute on function public.admin_publish_version(uuid,text,text,text[],text,jsonb) to authenticated;
grant execute on function public.admin_edit_application(uuid,text,text,text,text,text,text,jsonb) to authenticated;
grant execute on function public.developer_resubmit_version(uuid,text,text[]) to authenticated;

notify pgrst, 'reload schema';
