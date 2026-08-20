-- QBBE Hub — bring the integration jobs onto the one runtime.
--
-- Google sync, Gmail watch renewal, VMS sync and scheduled announcements
-- previously ran as their own HTTP routes behind a separate bearer-token check,
-- with their own execution ledger. They are now registry handlers like every
-- other job, which means they inherit one authentication path, one `job_run`
-- record per execution, and one Admin panel.
--
-- `background_job_run` stays: it carries per-organization detail (which
-- connection, how many profiles updated) that the runtime-level `job_run` row
-- does not, and Admin reads both.

insert into job_definition (name, description, schedule, queue, batch_size, max_attempts)
values
  ('scheduled-announcements',
   'Fans out notifications for announcements whose publish time has arrived.',
   '*/5 * * * *', null, 50, 3),

  ('google-sync',
   'Pulls Gmail metadata, Calendar overlay and Drive links for every connected account.',
   '*/15 * * * *', 'integrations', 50, 3),

  ('gmail-watch-renew',
   'Renews Gmail push subscriptions a day before they lapse.',
   '0 7 * * *', 'integrations', 50, 3),

  ('vms-sync',
   'Refreshes volunteer availability from the Volunteer Management System.',
   '0 8 * * *', 'integrations', 50, 3)
on conflict (name) do nothing;

do $$
declare
  j record;
begin
  for j in
    select name, schedule from job_definition
    where name in ('scheduled-announcements', 'google-sync', 'gmail-watch-renew', 'vms-sync')
  loop
    perform cron.unschedule(j.name)
      where exists (select 1 from cron.job c where c.jobname = j.name);
    perform cron.schedule(j.name, j.schedule,
      format('select app.dispatch_job(%L)', j.name));
  end loop;
end;
$$;
