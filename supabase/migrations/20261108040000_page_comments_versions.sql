-- Workspace OS wave 1, U9: comments and versions on pages and meetings
-- (epic #199; plan A10 and V1-17).
--
-- Pages are not registered objects yet (their access rule is app.can_page,
-- 20261103010100) and meetings are native records whose rules are
-- app.can_read_meeting / app.can_manage_meeting, so neither answers through
-- app.can. Until now that left pages and meetings without comments of their
-- own and without version snapshots. This migration:
--
--   * adds the comment parent type `page`, whose reading follows the page's
--     read rule and whose posting follows its write rule;
--   * introduces one type-aware check, app.can_object_content(type, id,
--     capability), that delegates to the page rule, the meeting rules or
--     app.can, and makes save_object_version and the version read policy use
--     it, so a page or a meeting can be snapshotted, compared and restored;
--
-- Meeting notes are already an editor document (20261107030100, I5), with
-- the same read and manage rules this file uses for meeting versions.
--
-- object_version.object_id has never had a foreign key to public.object
-- (pages were expected to be registered later), so nothing has to be relaxed:
-- the type-aware check is what keeps an id and its type honest, because a
-- page id with type `task` (or the reverse) answers false everywhere.

-- ---------------------------------------------------------------------------
-- One access question for versioned content
-- ---------------------------------------------------------------------------

create or replace function app.can_object_content(p_type text, p_object uuid, p_capability text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null or p_object is null then false
    when p_type = 'page' then app.can_page(p_object, p_capability)
    when p_type = 'meeting' then case
      when lower(coalesce(p_capability, '')) in ('view', 'read') then app.can_read_meeting(p_object)
      when lower(coalesce(p_capability, '')) in
        ('comment', 'edit_content', 'edit_structure', 'manage', 'share', 'run_workflow')
        then app.can_manage_meeting(p_object)
      else false
    end
    else app.can(p_object, p_capability)
  end;
$$;

create or replace function public.can_object_content(p_object uuid, p_type text, p_capability text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.can_object_content(p_type, p_object, p_capability);
$$;

revoke all on function app.can_object_content(text, uuid, text) from public, anon;
revoke all on function public.can_object_content(uuid, text, text) from public, anon;
grant execute on function app.can_object_content(text, uuid, text) to authenticated, service_role;
grant execute on function public.can_object_content(uuid, text, text) to authenticated, service_role;

comment on function app.can_object_content(text, uuid, text) is
  'Workspace OS U9: app.can for versioned content, with pages answered by app.can_page and meetings by the meeting rules.';

-- ---------------------------------------------------------------------------
-- Comments on pages
-- ---------------------------------------------------------------------------

alter table public.record_comment
  drop constraint if exists record_comment_parent_type_check;
alter table public.record_comment
  add constraint record_comment_parent_type_check
  check (parent_type in (
    'project', 'task', 'milestone', 'event', 'meeting', 'agenda_item',
    'risk', 'issue', 'update', 'organization', 'contact', 'opportunity',
    'object', 'page'
  ));

-- Same body as 20261103110100 plus the `page` branch.
create or replace function public.can_read_comment_parent(
  p_type text,
  p_id uuid
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case p_type
    when 'project' then app.has_project_capability(p_id, 'read')
    when 'task' then app.has_task_capability(p_id, 'read')
    when 'milestone' then exists (
      select 1 from public.milestone m
      where m.id = p_id and app.has_project_capability(m.project_id, 'read')
    )
    when 'event' then app.can_read_event(p_id)
    when 'meeting' then app.can_read_meeting(p_id)
    when 'agenda_item' then exists (
      select 1 from public.agenda_item a
      where a.id = p_id and app.can_read_meeting(a.meeting_id)
    )
    when 'risk' then exists (
      select 1 from public.risk r
      where r.id = p_id and app.has_project_capability(r.project_id, 'read')
    )
    when 'issue' then exists (
      select 1 from public.issue i
      where i.id = p_id and app.has_project_capability(i.project_id, 'read')
    )
    when 'update' then exists (
      select 1 from public.project_status_update u
      where u.id = p_id and app.has_project_capability(u.project_id, 'read')
    )
    when 'organization' then app.can_access_crm((
      select c.organization_id from public.crm_organization c where c.id = p_id
    ))
    when 'contact' then app.can_access_crm((
      select c.organization_id from public.crm_contact c where c.id = p_id
    ))
    when 'opportunity' then app.can_access_crm((
      select o.organization_id from public.opportunity o where o.id = p_id
    ))
    when 'object' then app.can(p_id, 'view')
    when 'page' then app.can_page(p_id, 'view')
    else false
  end;
$$;

-- Posting on a page needs its write rule (app.can_page's `comment`): staff and
-- two-step owners and admins on a workspace page, the creator on a private
-- one. Leadership viewers read workspace pages but do not comment on them, as
-- they do not write them.
create or replace function public.can_post_comment(p_type text, p_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case p_type
    when 'object' then app.can(p_id, 'comment')
    when 'page' then app.can_page(p_id, 'comment')
    else public.can_read_comment_parent(p_type, p_id)
  end;
$$;

-- ---------------------------------------------------------------------------
-- Versions of pages and meetings
-- ---------------------------------------------------------------------------

-- Same body as 20261103110200, with the type-aware edit check.
create or replace function public.save_object_version(
  p_object uuid,
  p_type text,
  p_kind text,
  p_content jsonb,
  p_properties jsonb,
  p_label text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_organization();
  v_hash text := md5(coalesce(p_content, '{}'::jsonb)::text || coalesce(p_properties, '{}'::jsonb)::text);
  v_last public.object_version%rowtype;
  v_id uuid;
begin
  if (select auth.uid()) is null or v_org is null then
    raise exception 'Sign in to save a version.' using errcode = '42501';
  end if;
  if p_kind not in ('auto', 'manual', 'restore') then
    raise exception 'Unknown kind of version: %.', p_kind using errcode = 'check_violation';
  end if;
  if not app.can_object_content(p_type, p_object, 'edit_content') then
    raise exception 'You cannot edit this object.' using errcode = '42501';
  end if;
  if exists (select 1 from public.object_trash t
             where t.object_id = p_object and t.restored_at is null and t.purged_at is null) then
    raise exception 'Restore this object from the trash before saving a version.'
      using errcode = '42501';
  end if;

  if p_kind = 'auto' then
    select * into v_last from public.object_version v
    where v.object_id = p_object
    order by v.created_at desc
    limit 1;
    if found and (v_last.created_at > now() - interval '10 minutes' or v_last.content_hash = v_hash) then
      return null;
    end if;
  end if;

  insert into public.object_version (
    organization_id, object_id, object_type, kind, label,
    content, properties, content_hash, created_by
  ) values (
    v_org, p_object, p_type, p_kind, nullif(btrim(coalesce(p_label, '')), ''),
    coalesce(p_content, '{}'::jsonb), coalesce(p_properties, '{}'::jsonb), v_hash,
    (select auth.uid())
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Reading a version follows the object as its type says, so a page's history
-- is visible to the people who can read the page.
drop policy if exists object_version_read on public.object_version;
create policy object_version_read on public.object_version
  for select to authenticated
  using (
    app.is_org_member(organization_id)
    and public.can_object_content(object_id, object_type, 'view')
  );

comment on table public.object_version is
  'Workspace OS M16a: snapshots of an object''s content and properties. Written by save_object_version only. '
  'U9: pages (app.can_page) and meetings (the meeting rules) are versioned too.';
