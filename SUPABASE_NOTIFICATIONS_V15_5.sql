-- Mada Apps V15.5 — notifications de mise à jour des applications
-- Une nouvelle version publiée d'une application déjà publiée crée une
-- notification persistante pour chaque compte concerné.

alter table public.notifications
  add column if not exists type text not null default 'general',
  add column if not exists app_id uuid,
  add column if not exists app_slug text,
  add column if not exists version text,
  add column if not exists event_key text,
  add column if not exists changes text[] not null default '{}'::text[],
  add column if not exists read_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'notifications_app_id_fkey'
      and conrelid = 'public.notifications'::regclass
  ) then
    alter table public.notifications
      add constraint notifications_app_id_fkey
      foreign key (app_id) references public.applications(id) on delete cascade;
  end if;
end
$$;

create unique index if not exists notifications_user_event_key_uidx
  on public.notifications(user_id, event_key)
  where event_key is not null;

create index if not exists notifications_user_unread_created_idx
  on public.notifications(user_id, "read", created_at desc);

create index if not exists notifications_app_id_idx
  on public.notifications(app_id);

alter table public.notifications enable row level security;

drop policy if exists notifications_admin_only on public.notifications;
drop policy if exists notifications_select_own on public.notifications;
drop policy if exists notifications_update_own on public.notifications;

create policy notifications_select_own
on public.notifications
for select
to authenticated
using ((select auth.uid()) = user_id or private.is_admin());

create policy notifications_update_own
on public.notifications
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke all on public.notifications from anon;
revoke insert, delete, truncate, references, trigger on public.notifications from authenticated;
revoke update on public.notifications from authenticated;
grant select on public.notifications to authenticated;
grant update ("read", read_at) on public.notifications to authenticated;

create or replace function private.create_app_update_notifications()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  app_record public.applications%rowtype;
  prior_published_count integer := 0;
  change_summary text := '';
begin
  if new.status is distinct from 'published' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'published' then
    return new;
  end if;

  select * into app_record
  from public.applications
  where id = new.app_id;

  if not found or app_record.status is distinct from 'published' then
    return new;
  end if;

  select count(*) into prior_published_count
  from public.app_versions v
  where v.app_id = new.app_id
    and v.id <> new.id
    and v.status = 'published';

  if prior_published_count = 0 then
    return new;
  end if;

  if cardinality(coalesce(new.changes, '{}'::text[])) > 0 then
    change_summary := array_to_string(
      new.changes[1:least(cardinality(new.changes), 3)],
      ' • '
    );
  end if;

  insert into public.notifications(
    user_id,title,message,"read",type,app_id,app_slug,version,event_key,changes,created_at
  )
  select
    u.id,
    'Mise à jour disponible : ' || app_record.name,
    'La version ' || new.version || ' de ' || app_record.name || ' est disponible.'
      || case when change_summary <> '' then ' ' || left(change_summary, 500) else '' end,
    false,
    'app_update',
    new.app_id,
    app_record.slug,
    new.version,
    'app_update:' || new.id::text,
    coalesce(new.changes, '{}'::text[]),
    now()
  from auth.users u
  left join public.profiles p on p.id = u.id
  where app_record.visibility = 'public'
     or (
       app_record.visibility = 'gendarmerie'
       and (
         coalesce(p.is_admin, false)
         or p.role in ('ADMIN','GENDARMERIE')
         or p.access_level = 'gendarme'
       )
     )
  on conflict (user_id,event_key)
  where event_key is not null
  do nothing;

  return new;
end
$$;

revoke all on function private.create_app_update_notifications() from public;
revoke all on function private.create_app_update_notifications() from anon;
revoke all on function private.create_app_update_notifications() from authenticated;

drop trigger if exists app_versions_notify_update on public.app_versions;
create trigger app_versions_notify_update
after insert or update of status on public.app_versions
for each row
execute function private.create_app_update_notifications();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
