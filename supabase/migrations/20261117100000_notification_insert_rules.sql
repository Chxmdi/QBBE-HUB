-- Notifications a member creates for someone else.
--
-- The insert policy only checked that the writer belonged to the
-- organization. Any member, guests included, could therefore create
-- notifications for anyone, in any category (including 'security', which
-- nobody can mute and which is always emailed), with any link, including one
-- to another site. Those rows reach the inbox, the bell and email.
--
-- Now a member may only create an ordinary notification for an active member
-- of the same organization (one for anyone else is skipped), with no link or
-- an in-app path; an announcement notification must point at an announcement
-- the member published. 'security'
-- notifications come only from server code (the service role and definer
-- functions, which are not bound by this policy). The link rule is also a
-- table constraint, so it holds for updates and for every writer.

-- An in-app path: one leading slash, not two, and only URL-safe characters
-- (no spaces, quotes, angle brackets or backslashes).
create or replace function app.is_in_app_link(p_link text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_link ~ '^/([A-Za-z0-9_?=&%.#~:@!*()+,;-][A-Za-z0-9/_?=&%.#~:@!*()+,;-]*)?$';
$$;

revoke all on function app.is_in_app_link(text) from public, anon;
grant execute on function app.is_in_app_link(text) to authenticated, service_role;

-- Definer so the check does not depend on which memberships the writer may
-- read. It answers only "is this person an active member of this
-- organization", and the policy only asks it about the caller's own one.
create or replace function app.is_active_member_of(p_organization uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_membership m
    where m.organization_id = p_organization
      and m.user_id = p_user
      and m.status = 'active'
  );
$$;

revoke all on function app.is_active_member_of(uuid, uuid) from public, anon;
grant execute on function app.is_active_member_of(uuid, uuid) to authenticated, service_role;

-- An announcement notification can only point at an announcement the writer
-- published in that organization. High and critical announcements are always
-- shown and emailed, so they must not be something anyone can make up.
create or replace function app.is_own_announcement(p_organization uuid, p_announcement uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.announcement a
    where a.id = p_announcement
      and a.organization_id = p_organization
      and a.created_by = (select auth.uid())
  );
$$;

revoke all on function app.is_own_announcement(uuid, uuid) from public, anon;
grant execute on function app.is_own_announcement(uuid, uuid) to authenticated, service_role;

-- A member's notification for someone who is no longer an active member of
-- the organization is skipped rather than refused: the app notifies past
-- reviewers and assignees after saving the change itself, and a person who
-- has left must neither receive it nor make that change look failed.
-- Applies to requests made with a member's session (including definer
-- functions they call); the service role's jobs choose their own recipients.
create or replace function app.notification_skip_inactive_recipient()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt()->>'role', '') = 'authenticated'
     and not app.is_active_member_of(new.organization_id, new.user_id) then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function app.notification_skip_inactive_recipient() from public, anon, authenticated;

drop trigger if exists notification_skip_inactive_recipient on public.notification;
create trigger notification_skip_inactive_recipient
  before insert on public.notification
  for each row execute function app.notification_skip_inactive_recipient();

drop policy if exists notification_insert on public.notification;
create policy notification_insert on public.notification
  for insert to authenticated
  with check (
    app.is_org_member(organization_id)
    and app.is_active_member_of(organization_id, user_id)
    and category <> 'security'
    and (category <> 'announcement'
         or (source_type = 'announcement' and app.is_own_announcement(organization_id, source_id)))
    and (link is null or app.is_in_app_link(link))
  );

-- Existing rows: drop any link that is not an in-app path before the
-- constraint is validated. The notification itself stays.
alter table public.notification
  add constraint notification_link_in_app
  check (link is null or app.is_in_app_link(link)) not valid;

update public.notification
set link = null
where link is not null and not app.is_in_app_link(link);

alter table public.notification validate constraint notification_link_in_app;
