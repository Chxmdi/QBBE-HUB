-- ---------------------------------------------------------------------------
-- Is the job runner wired to this deployment?
--
-- Every background job (virus scans that make uploads openable, notification
-- email, Gmail sync, retention) is dispatched by pg_cron to the URL and secret
-- stored by app.configure_job_runner. A deployment that skips that step looks
-- healthy: pages load, uploads succeed. But no file ever passes its security
-- check and no notification is ever sent. The deploy smoke check and the admin
-- Jobs page ask this function, so the gap is caught instead of discovered.
--
-- The answer is one word. The stored URL and secret never leave the database:
-- the caller passes the site's own origin and its own secret, and only whether
-- they match comes back.
-- ---------------------------------------------------------------------------

create or replace function app.job_runner_status(p_site_origin text, p_app_secret text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_endpoint text;
  v_secret text;
begin
  select decrypted_secret into v_endpoint
  from vault.decrypted_secrets where name = 'qbbe_job_endpoint';
  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'qbbe_job_secret';

  if v_endpoint is null or v_secret is null then
    return 'not_configured';
  end if;
  if p_site_origin is not null
     and rtrim(lower(v_endpoint), '/') <> rtrim(lower(p_site_origin), '/') then
    return 'other_site';
  end if;
  if p_app_secret is null or p_app_secret = '' then
    return 'app_secret_missing';
  end if;
  if v_secret <> p_app_secret then
    return 'secret_mismatch';
  end if;
  return 'ready';
end;
$$;

revoke all on function app.job_runner_status(text, text) from public, anon, authenticated;
grant execute on function app.job_runner_status(text, text) to service_role;

-- Exposed to the Data API for the service role only (the app server).
create or replace function public.job_runner_status(p_site_origin text, p_app_secret text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select app.job_runner_status(p_site_origin, p_app_secret);
$$;

revoke all on function public.job_runner_status(text, text) from public, anon, authenticated;
grant execute on function public.job_runner_status(text, text) to service_role;
