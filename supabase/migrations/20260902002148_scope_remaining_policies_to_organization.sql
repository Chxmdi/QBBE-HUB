-- ---------------------------------------------------------------------------
-- Scope the last policies that still trusted "a member of some organization".
--
-- `app.is_member()`, `app.is_staff()` and `app.is_admin()` take no argument.
-- They answer "does this user hold an active membership anywhere", which is
-- not the question a policy on an organization-owned row is asking. Used as a
-- permissive USING clause they grant every row in the table to every active
-- user of every tenant.
--
-- The August scoping pass replaced them across identity, programs, projects,
-- tasks, CRM and meetings, and the allow/deny suite grew cross-organization
-- assertions for exactly those tables. Announcements, documents, channels and
-- the email ledger were missed, and because no assertion covered them the gap
-- stayed invisible: a suite only defends what it names.
--
-- The product is multi-organization by construction — every one of these
-- tables carries `organization_id` — so this is a real isolation boundary,
-- currently latent only because production holds a single organization. It
-- would become live the moment a second one exists, which is the worst
-- possible time to discover it.
--
-- Behaviour within an organization is unchanged; each policy keeps its shape
-- and gains the organization argument it should always have had.
-- ---------------------------------------------------------------------------

-- Announcements -------------------------------------------------------------
drop policy if exists announcement_read on announcement;
create policy announcement_read on announcement
  for select to authenticated
  using (app.is_org_member(organization_id));

drop policy if exists announcement_admin_insert on announcement;
create policy announcement_admin_insert on announcement
  for insert to authenticated
  with check (app.is_org_admin(organization_id) and created_by = (select auth.uid()));

-- An acknowledgement carries no organization of its own; it borrows the one
-- from the announcement it answers.
drop policy if exists ack_read on announcement_acknowledgment;
create policy ack_read on announcement_acknowledgment
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from announcement a
      where a.id = announcement_id and app.is_org_admin(a.organization_id)
    )
  );

-- Channels ------------------------------------------------------------------
drop policy if exists channel_read on channel;
create policy channel_read on channel
  for select to authenticated
  using (
    (privacy = 'public' and app.is_org_member(organization_id))
    or app.is_channel_member(id)
  );

drop policy if exists channel_staff_insert on channel;
create policy channel_staff_insert on channel
  for insert to authenticated
  with check (app.is_org_staff(organization_id));

drop policy if exists channel_manage on channel;
create policy channel_manage on channel
  for update to authenticated
  using (app.is_org_admin(organization_id) or owner_id = (select auth.uid()))
  with check (app.is_org_admin(organization_id) or owner_id = (select auth.uid()));

drop policy if exists channel_admin_delete on channel;
create policy channel_admin_delete on channel
  for delete to authenticated
  using (app.is_org_admin(organization_id));

-- Documents -----------------------------------------------------------------
drop policy if exists document_read on document;
create policy document_read on document
  for select to authenticated
  using (
    app.is_org_staff(organization_id)
    or (visibility = 'organization' and app.is_org_member(organization_id))
  );

drop policy if exists document_member_insert on document;
create policy document_member_insert on document
  for insert to authenticated
  with check (app.is_org_member(organization_id) and created_by = (select auth.uid()));

drop policy if exists document_update on document;
create policy document_update on document
  for update to authenticated
  using (app.is_org_staff(organization_id) or owner_id = (select auth.uid()))
  with check (app.is_org_staff(organization_id) or owner_id = (select auth.uid()));

drop policy if exists document_delete on document;
create policy document_delete on document
  for delete to authenticated
  using (app.is_org_admin(organization_id) or owner_id = (select auth.uid()));

-- The email ledger ----------------------------------------------------------
-- Who was mailed, about what, is among the most sensitive rows here: it names
-- people and the subjects they were contacted about.
drop policy if exists email_delivery_admin_read on email_delivery;
create policy email_delivery_admin_read on email_delivery
  for select to authenticated
  using (app.is_org_admin(organization_id));

-- Pins, conversations, reactions, mentions ----------------------------------
drop policy if exists pinned_write on pinned_resource;
create policy pinned_write on pinned_resource
  for insert to authenticated
  with check (
    app.is_channel_member(channel_id)
    and exists (
      select 1 from channel c
      where c.id = channel_id and app.is_org_staff(c.organization_id)
    )
  );

drop policy if exists pinned_delete on pinned_resource;
create policy pinned_delete on pinned_resource
  for delete to authenticated
  using (
    app.is_channel_member(channel_id)
    and exists (
      select 1 from channel c
      where c.id = channel_id and app.is_org_staff(c.organization_id)
    )
  );

drop policy if exists conversation_create on conversation;
create policy conversation_create on conversation
  for insert to authenticated
  with check (app.is_org_member(organization_id) and created_by = (select auth.uid()));

drop policy if exists notification_insert on notification;
create policy notification_insert on notification
  for insert to authenticated
  with check (app.is_org_member(organization_id));

-- A reaction is visible exactly when its message is. The membership conjunct
-- added nothing once the message row has passed its own policy, and being
-- unscoped it was the only part that could admit another tenant.
drop policy if exists reaction_read on message_reaction;
create policy reaction_read on message_reaction
  for select to authenticated
  using (exists (select 1 from message m where m.id = message_id));

drop policy if exists mention_insert on message_mention;
create policy mention_insert on message_mention
  for insert to authenticated
  with check (exists (select 1 from message m where m.id = message_id));

-- Decisions recorded outside a meeting fall back to staff; scope that too.
drop policy if exists decision_read on decision;
create policy decision_read on decision
  for select to authenticated
  using (
    (meeting_id is not null and app.can_read_meeting(meeting_id))
    or (meeting_id is null and app.is_org_staff(organization_id))
  );

-- Task dependencies borrow the organization of the task they block.
drop policy if exists task_dependency_staff_write on task_dependency;
create policy task_dependency_staff_write on task_dependency
  for all to authenticated
  using (
    exists (select 1 from task t
            where t.id = blocked_task_id and app.is_org_staff(t.organization_id))
  )
  with check (
    exists (select 1 from task t
            where t.id = blocked_task_id and app.is_org_staff(t.organization_id))
  );

drop policy if exists task_comment_insert on task_comment;
create policy task_comment_insert on task_comment
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (select 1 from task t where t.id = task_id)
  );

drop policy if exists message_author_update on message;
create policy message_author_update on message
  for update to authenticated
  using (author_id = (select auth.uid()) or app.is_org_admin(organization_id))
  with check (author_id = (select auth.uid()) or app.is_org_admin(organization_id));

drop policy if exists channel_member_update_self on channel_member;
create policy channel_member_update_self on channel_member
  for update to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from channel c
               where c.id = channel_id and app.is_org_admin(c.organization_id))
  );

drop policy if exists calendar_event_link_own_delete on calendar_event_link;
create policy calendar_event_link_own_delete on calendar_event_link
  for delete to authenticated
  using (user_id = (select auth.uid()) or app.is_org_admin(organization_id));

drop policy if exists gmail_message_own_delete on gmail_message;
create policy gmail_message_own_delete on gmail_message
  for delete to authenticated
  using (user_id = (select auth.uid()) or app.is_org_admin(organization_id));
