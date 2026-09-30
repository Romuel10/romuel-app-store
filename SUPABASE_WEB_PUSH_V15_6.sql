-- =========================================================
-- Mada Apps V15.6 — Web Push / PWA
-- Les clés VAPID privées sont générées par setup-web-push et
-- stockées chiffrées dans Supabase Vault. Aucun secret ici.
-- =========================================================

create extension if not exists pg_net;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, endpoint)
);

create index if not exists push_subscriptions_user_enabled_idx
  on public.push_subscriptions(user_id, enabled);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;

create policy push_subscriptions_select_own
on public.push_subscriptions
for select to authenticated
using ((select auth.uid()) = user_id);

create policy push_subscriptions_insert_own
on public.push_subscriptions
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy push_subscriptions_update_own
on public.push_subscriptions
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy push_subscriptions_delete_own
on public.push_subscriptions
for delete to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create table if not exists public.web_push_config_public (
  id smallint primary key default 1 check (id=1),
  public_key text not null,
  updated_at timestamptz not null default now()
);

alter table public.web_push_config_public enable row level security;

drop policy if exists web_push_config_public_read on public.web_push_config_public;
create policy web_push_config_public_read
on public.web_push_config_public
for select to anon, authenticated
using (true);

revoke all on public.web_push_config_public from anon, authenticated;
grant select on public.web_push_config_public to anon, authenticated;

create or replace function public.get_web_push_config_internal()
returns table(
  public_key text,
  private_key text,
  internal_token text,
  subject text
)
language sql
security definer
set search_path = pg_catalog, vault
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name='mada_web_push_public_key' limit 1),
    (select decrypted_secret from vault.decrypted_secrets where name='mada_web_push_private_key' limit 1),
    (select decrypted_secret from vault.decrypted_secrets where name='mada_web_push_internal_token' limit 1),
    'https://github.com/Romuel10/romuel-app-store'::text
$$;

revoke all on function public.get_web_push_config_internal() from public;
revoke all on function public.get_web_push_config_internal() from anon;
revoke all on function public.get_web_push_config_internal() from authenticated;
grant execute on function public.get_web_push_config_internal() to service_role;

create or replace function public.store_web_push_config_internal(
  p_public_key text,
  p_private_key text,
  p_internal_token text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $$
declare
  sid uuid;
begin
  select id into sid from vault.decrypted_secrets where name='mada_web_push_public_key' limit 1;
  if sid is null then
    perform vault.create_secret(p_public_key,'mada_web_push_public_key','Mada Apps VAPID public key');
  else
    perform vault.update_secret(sid,p_public_key);
  end if;

  select id into sid from vault.decrypted_secrets where name='mada_web_push_private_key' limit 1;
  if sid is null then
    perform vault.create_secret(p_private_key,'mada_web_push_private_key','Mada Apps VAPID private key');
  else
    perform vault.update_secret(sid,p_private_key);
  end if;

  select id into sid from vault.decrypted_secrets where name='mada_web_push_internal_token' limit 1;
  if sid is null then
    perform vault.create_secret(p_internal_token,'mada_web_push_internal_token','Mada Apps internal push token');
  else
    perform vault.update_secret(sid,p_internal_token);
  end if;

  insert into public.web_push_config_public(id,public_key,updated_at)
  values(1,p_public_key,now())
  on conflict(id) do update
  set public_key=excluded.public_key,updated_at=excluded.updated_at;
end
$$;

revoke all on function public.store_web_push_config_internal(text,text,text) from public;
revoke all on function public.store_web_push_config_internal(text,text,text) from anon;
revoke all on function public.store_web_push_config_internal(text,text,text) from authenticated;
grant execute on function public.store_web_push_config_internal(text,text,text) to service_role;

create or replace function private.dispatch_app_update_web_push()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, vault, net
as $$
declare
  app_record public.applications%rowtype;
  prior_published_count integer := 0;
  push_token text;
begin
  if new.status is distinct from 'published' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'published' then return new; end if;

  select * into app_record
  from public.applications
  where id = new.app_id;

  if not found or app_record.status is distinct from 'published' then return new; end if;

  select count(*) into prior_published_count
  from public.app_versions v
  where v.app_id = new.app_id
    and v.id <> new.id
    and v.status = 'published';

  if prior_published_count = 0 then return new; end if;

  select decrypted_secret into push_token
  from vault.decrypted_secrets
  where name='mada_web_push_internal_token'
  limit 1;

  if push_token is null or push_token='' then return new; end if;

  perform net.http_post(
    url := 'https://gmlofgsgnbbcbefogpww.supabase.co/functions/v1/send-update-push',
    body := jsonb_build_object('version_id',new.id),
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-mada-push-token',push_token
    ),
    timeout_milliseconds := 10000
  );

  return new;
end
$$;

revoke all on function private.dispatch_app_update_web_push() from public;
revoke all on function private.dispatch_app_update_web_push() from anon;
revoke all on function private.dispatch_app_update_web_push() from authenticated;

drop trigger if exists app_versions_dispatch_web_push on public.app_versions;

create trigger app_versions_dispatch_web_push
after insert or update of status on public.app_versions
for each row
execute function private.dispatch_app_update_web_push();

-- Après déploiement des Edge Functions, appeler setup-web-push une fois.
