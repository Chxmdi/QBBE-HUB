-- Job runner status (migration 20261002100000). Proves the status word for
-- each wiring state, that the stored URL and secret are never returned, and
-- that only the service role can ask. Run after qa-users.sql and rls.sql.
-- All changes are rolled back.
begin;

do $$
declare
  v_status text;
  v_secret text := repeat('s', 40);
  v_error text;
begin
  -- Start from a clean slate inside this transaction.
  delete from vault.secrets where name in ('qbbe_job_endpoint', 'qbbe_job_secret');

  v_status := app.job_runner_status('https://hub.example.org', v_secret);
  perform tests.ok(v_status = 'not_configured', 'no runner configured reads not_configured');

  perform app.configure_job_runner('https://hub.example.org/', v_secret);

  v_status := app.job_runner_status('https://hub.example.org', v_secret);
  perform tests.ok(v_status = 'ready', 'same site (trailing slash ignored) and same secret reads ready');

  v_status := app.job_runner_status('HTTPS://HUB.EXAMPLE.ORG/', v_secret);
  perform tests.ok(v_status = 'ready', 'the site comparison ignores case');

  v_status := app.job_runner_status('https://staging.example.org', v_secret);
  perform tests.ok(v_status = 'other_site', 'a runner pointed at another site reads other_site');

  v_status := app.job_runner_status('https://hub.example.org', repeat('x', 40));
  perform tests.ok(v_status = 'secret_mismatch', 'a different app secret reads secret_mismatch');

  v_status := app.job_runner_status('https://hub.example.org', null);
  perform tests.ok(v_status = 'app_secret_missing', 'a site without CRON_JOB_SECRET reads app_secret_missing');

  v_status := public.job_runner_status('https://hub.example.org', v_secret);
  perform tests.ok(v_status = 'ready', 'the Data API wrapper answers the same');
  perform tests.ok(v_status !~ 'example|sss', 'the answer never contains the stored URL or secret');

  -- Only the service role may ask.
  perform tests.ok(not has_function_privilege('authenticated', 'public.job_runner_status(text, text)', 'execute'),
    'signed-in users cannot call job_runner_status');
  perform tests.ok(not has_function_privilege('anon', 'public.job_runner_status(text, text)', 'execute'),
    'anonymous callers cannot call job_runner_status');
  perform tests.ok(has_function_privilege('service_role', 'public.job_runner_status(text, text)', 'execute'),
    'the service role can call job_runner_status');

  set local role authenticated;
  begin
    perform public.job_runner_status('https://hub.example.org', v_secret);
    v_error := null;
  exception when others then
    v_error := sqlerrm;
  end;
  reset role;
  perform tests.ok(v_error ilike '%permission denied%',
    format('an authenticated call is refused (%s)', coalesce(v_error, 'no error')));
end;
$$;

rollback;
