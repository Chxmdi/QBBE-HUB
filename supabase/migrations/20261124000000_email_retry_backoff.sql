-- Email retries that outlast a provider outage, and a way to send failed
-- email again.
--
-- A failed send used to come back every two minutes, so its five attempts
-- were spent in about ten minutes and any outage longer than that marked the
-- email failed for good, with no way to try it again. The drain job now waits
-- longer after each failure (1, 4, 16 minutes, then hourly), and the attempt
-- limit rises to eight so the retries span roughly four hours. The stuck-email
-- sweep uses the same limit.
--
-- requeue_failed_email_deliveries lets an administrator put their own
-- organization's failed email from the last seven days back in the queue
-- (Admin > Jobs). Bounced, suppressed and sent email is never touched, nor
-- email the stuck-email sweep gave up on, nor a notification email whose
-- notification was deleted or read; the drain job re-checks quiet hours and
-- the person's email settings before sending a notification email. Each
-- email keeps its id, and the id is the provider's idempotency key, so a send
-- the provider did accept is not delivered twice within its idempotency window.

update public.job_definition
set max_attempts = 8
where name in ('drain-notifications', 'retry-failed-emails');

create or replace function public.requeue_failed_email_deliveries(p_organization uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  if p_organization is null or not app.is_org_admin(p_organization) then
    raise exception 'only an administrator of this organization can re-queue email'
      using errcode = '42501';
  end if;

  for v_id in
    update email_delivery d
    set status = 'queued', attempt = 0, last_error = null, scheduled_for = null
    where d.id in (
      select f.id
      from email_delivery f
      where f.organization_id = p_organization
        and f.status = 'failed'
        and f.updated_at > now() - interval '7 days'
        -- Abandoned by the stuck-email sweep: the provider may have accepted
        -- it before the worker died, so sending it again could duplicate it.
        and coalesce(f.last_error, '') not like 'Gave up after %'
        -- A notification email whose notification was deleted or has been
        -- read has nothing left to say.
        and (f.kind <> 'notification' or exists (
          select 1 from notification n where n.id = f.notification_id and n.read_at is null
        ))
      order by f.updated_at
      limit 500
      for update skip locked
    )
    returning d.id
  loop
    perform pgmq.send('notifications', jsonb_build_object('kind', 'retry', 'delivery_id', v_id));
    v_count := v_count + 1;
  end loop;

  insert into audit_event (organization_id, actor_id, actor_type, event_type, action, object_type, metadata)
  values (p_organization, auth.uid(), 'user', 'communication', 'failed_emails_requeued', 'email_delivery',
          jsonb_build_object('count', v_count));

  return v_count;
end;
$$;

revoke all on function public.requeue_failed_email_deliveries(uuid) from public, anon;
grant execute on function public.requeue_failed_email_deliveries(uuid) to authenticated;
