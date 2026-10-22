-- API keys and the API call log.
--
-- The screen and server action make API keys staff-only, but the table's
-- insert policy only required organization membership, so a guest or
-- volunteer could create a long-lived key directly, and so could an owner
-- or administrator signed in with a password alone. Creating and revoking a
-- key left no audit entry. The API call log had no retention.
--
-- Now creating a key needs staff, or an owner or administrator with a
-- completed MFA sign-in (app.is_org_staff); creation and revocation are
-- audited by trigger; call logs older than 90 days are purged daily.

drop policy if exists api_token_owner_insert on public.api_token;
create policy api_token_owner_insert on public.api_token
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and app.is_org_staff(organization_id)
    and revoked_at is null
    and revoked_by is null
    and last_used_at is null
  );

create or replace function app.audit_api_token_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_event (organization_id, actor_id, actor_type, event_type, action,
                                    object_type, object_id, metadata)
    values (new.organization_id, (select auth.uid()),
            case when (select auth.uid()) is null then 'system' else 'user' end,
            'security', 'api_token_created', 'api_token', new.id,
            jsonb_build_object('name', new.name, 'owner_id', new.user_id, 'prefix', new.token_prefix,
                               'scopes', new.scopes, 'expires_at', new.expires_at));
  elsif new.revoked_at is not null and old.revoked_at is null then
    insert into public.audit_event (organization_id, actor_id, actor_type, event_type, action,
                                    object_type, object_id, metadata)
    values (new.organization_id, coalesce(new.revoked_by, (select auth.uid())),
            case when coalesce(new.revoked_by, (select auth.uid())) is null then 'system' else 'user' end,
            'security', 'api_token_revoked', 'api_token', new.id,
            jsonb_build_object('name', new.name, 'owner_id', new.user_id, 'prefix', new.token_prefix));
  end if;
  return null;
end;
$$;

revoke all on function app.audit_api_token_change() from public, anon, authenticated;

drop trigger if exists api_token_audited on public.api_token;
create trigger api_token_audited
  after insert or update of revoked_at on public.api_token
  for each row execute function app.audit_api_token_change();

create or replace function app.purge_api_request_log()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.api_request_log where created_at < now() - interval '90 days';
$$;

revoke all on function app.purge_api_request_log() from public, anon, authenticated;
grant execute on function app.purge_api_request_log() to service_role;

select cron.unschedule('purge-api-request-log')
where exists (select 1 from cron.job where jobname = 'purge-api-request-log');
select cron.schedule('purge-api-request-log', '35 4 * * *',
  $$select app.purge_api_request_log()$$);

comment on table public.api_request_log is
  'Private API calls made with a valid token, allowed or refused (V2-8). Written by the API route only; kept 90 days.';
