-- ---------------------------------------------------------------------------
-- A scheduled announcement stays hidden until its publish time.
--
-- Publishing posted the announcement's message into the announcements channel
-- straight away, even when the announcement was scheduled for later. Everyone
-- in the organization could read the text in the channel, on Home and through
-- realtime before the publish time; only the notifications waited.
--
-- Now a scheduled announcement keeps its text on the announcement row, with
-- no message, and the scheduled-announcements job posts the message once the
-- publish time has passed (app.release_scheduled_announcement). Until then
-- only administrators can read the row, and nobody can acknowledge it.
-- ---------------------------------------------------------------------------

alter table public.announcement
  alter column message_id drop not null,
  add column body text,
  add column channel_id uuid references public.channel (id) on delete cascade;

-- Either the message is posted, or the text and its channel wait on the row.
alter table public.announcement
  add constraint announcement_message_or_pending check (
    message_id is not null or (body is not null and channel_id is not null)
  );

create index if not exists idx_announcement_pending
  on public.announcement (publish_at)
  where message_id is null;

drop policy if exists announcement_read on public.announcement;
create policy announcement_read on public.announcement
  for select to authenticated
  using (
    app.is_org_member(organization_id)
    and (message_id is not null or app.is_org_admin(organization_id))
  );

-- Acknowledging needs an announcement the person can read and that has been
-- posted. Before, any signed-in person could insert an acknowledgement for any
-- announcement id, in any organization, scheduled or not.
drop policy if exists ack_insert on public.announcement_acknowledgment;
create policy ack_insert on public.announcement_acknowledgment
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.announcement a
      where a.id = announcement_id
        and a.message_id is not null
        and app.is_org_member(a.organization_id)
    )
  );

-- Posts the waiting message of one due announcement. Locks the row so two job
-- runs cannot post it twice; returns the message id, or null when the
-- announcement is not due yet or does not exist.
create or replace function public.release_scheduled_announcement(p_announcement uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.announcement%rowtype;
  v_message uuid;
begin
  select * into v_row from public.announcement where id = p_announcement for update;
  if not found then
    return null;
  end if;
  if v_row.message_id is not null then
    return v_row.message_id;
  end if;
  if v_row.publish_at > now() then
    return null;
  end if;

  insert into public.message (organization_id, channel_id, author_id, body)
  values (v_row.organization_id, v_row.channel_id, v_row.created_by, v_row.body)
  returning id into v_message;

  update public.announcement
     set message_id = v_message, body = null, channel_id = null
   where id = v_row.id;

  return v_message;
end;
$$;

revoke all on function public.release_scheduled_announcement(uuid) from public, anon, authenticated;
grant execute on function public.release_scheduled_announcement(uuid) to service_role;
