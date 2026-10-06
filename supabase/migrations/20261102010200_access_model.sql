-- Workspace OS access model: capabilities, roles, grants and inheritance
-- (M10b, epic #199, stream S2).
--
-- The design is the one the W0-7 access spike recommends
-- (docs/design/spikes/W0-7-access-check.md):
--
--   access_node   every securable thing with its chain of parents stored as
--                 an array (self first): a task, its project, its program's
--                 space. Spaces, projects, tasks and Workspace OS objects
--                 (pages, custom types) are nodes. Stored in `app`, never
--                 reachable through the API.
--   access_role   a named bundle of capabilities. Built-in rows restate
--                 today's roles; custom roles (M10d) are more rows.
--   access_grant  a role on a node, to a person, a team, or everyone with an
--                 organization role. It reaches the node and everything under
--                 it (`subtree`), the node only (`self`), or the node and the
--                 tasks directly under it (`self_and_child_tasks`, for the
--                 program lead column, which today reaches a program and its
--                 program-level tasks but not its projects).
--
-- Organization roles that reach everything (owner and admin, leadership
-- viewer), membership and two-step sign-in (MFA) are answered live, never
-- stored, so a promotion, a deactivation or a session without MFA takes
-- effect on the next statement. Private spaces are outside that reach.
--
-- Today's tables stay the source of truth. Triggers write them through
-- ("dual write") into grants, so the new model gives today's answers:
--
--   program.lead_id           manager on the program's space, self_and_child_tasks
--   program_access_grant      its role on the program's space (subtree)
--   project.owner_id          manager on the project
--   project_access_grant      its role on the project; `program_inherited`
--                             rows are skipped (inheritance gives the same)
--   task.assignee_id,         task_contributor on the task
--   task.requester_id
--   task.reviewer_id,         task_approver on the task
--   task.approver_id
--   task_assignment           task_<role> on the task
--   space (M10a)              private: manager for its owner; workspace:
--                             workspace_member for the staff role
--   object (S1, if present)   manager for its owner_id
--
-- Capability bits. The seven Workspace OS capabilities, then today's record
-- capabilities that have no Workspace OS word, so `app.can` keeps answering
-- today's names exactly as the W0-3 stand-in does (read is view):
--   view 1, comment 2, edit_content 4, edit_structure 8, manage 16,
--   run_workflow 32, share 64, review 128, approve 256, collaborate 512,
--   follow 1024.
-- A role's bits are today's capabilities through the stand-in's mapping:
--   read -> view; manage -> manage, edit_structure, share, run_workflow,
--   edit_content, comment; collaborate -> collaborate, edit_content, comment;
--   review -> review, comment; approve -> approve, comment; follow -> follow.
--
-- Deviation from the spike, on purpose: its follower and read-only roles
-- could comment, and "org reader" could comment. Today's rules do not allow
-- that (task_comment_insert needs manage, collaborate, review or approve), and
-- the W0-3 equivalence test pins it, so here they only view (and follow).

-- ---------------------------------------------------------------------------
-- Capability bits
-- ---------------------------------------------------------------------------

create or replace function app.cap_bit(p_capability text)
returns integer
language sql immutable parallel safe
set search_path = ''
as $$
  select case lower(coalesce(p_capability, ''))
    when 'view' then 1 when 'read' then 1
    when 'comment' then 2 when 'edit_content' then 4 when 'edit_structure' then 8
    when 'manage' then 16 when 'run_workflow' then 32 when 'share' then 64
    when 'review' then 128 when 'approve' then 256
    when 'collaborate' then 512 when 'follow' then 1024
    else 0
  end;
$$;

-- All bits of the seven Workspace OS capabilities, and all eleven.
create or replace function app.wos_bits()
returns integer language sql immutable parallel safe set search_path = ''
as $$ select 127; $$;
create or replace function app.all_bits()
returns integer language sql immutable parallel safe set search_path = ''
as $$ select 2047; $$;

create or replace function app.caps_to_bits(p_capabilities text[])
returns integer
language sql immutable parallel safe
set search_path = ''
as $$
  select coalesce(bit_or(app.cap_bit(c)), 0)::integer from unnest(p_capabilities) c;
$$;

-- The Workspace OS capability names a bit set holds, in contract order.
create or replace function app.bits_to_caps(p_bits integer)
returns text[]
language sql immutable parallel safe
set search_path = ''
as $$
  select coalesce(array_agg(c order by ord), array[]::text[])
  from unnest(app.wos_capabilities()) with ordinality as a (c, ord)
  where coalesce(p_bits, 0) & app.cap_bit(c) <> 0;
$$;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

create table public.access_role (
  id uuid primary key default gen_random_uuid(),
  -- Null for the built-in roles, which every organization shares.
  organization_id uuid references public.organization (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  name_en text not null check (char_length(btrim(name_en)) between 1 and 80),
  name_fr text not null check (char_length(btrim(name_fr)) between 1 and 80),
  caps integer not null check (caps > 0 and caps & ~2047 = 0),
  builtin boolean not null default false,
  created_by uuid references public.user_profile (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_role_builtin_shape check (builtin = (organization_id is null)),
  -- Custom roles hold Workspace OS capabilities only; today's names stay
  -- with the built-in roles that restate today's rules.
  constraint access_role_custom_caps check (builtin or caps & ~127 = 0)
);
create unique index access_role_builtin_key on public.access_role (key) where organization_id is null;
create unique index access_role_org_key on public.access_role (organization_id, key) where organization_id is not null;

create trigger access_role_set_updated_at
  before update on public.access_role
  for each row execute function public.set_updated_at();

comment on table public.access_role is
  'Workspace OS roles (M10b): named capability bundles. Built-in rows restate today''s roles; custom roles arrive in M10d.';

insert into public.access_role (organization_id, key, name_en, name_fr, caps, builtin) values
  (null, 'manager', 'Manager', 'Gestionnaire', 2047, true),
  (null, 'contributor', 'Contributor', 'Collaborateur', 1|2|4|512|1024, true),
  (null, 'reviewer', 'Reviewer', 'Réviseur', 1|2|128|1024, true),
  (null, 'approver', 'Approver', 'Approbateur', 1|2|128|256|1024, true),
  (null, 'follower', 'Follower', 'Abonné', 1|1024, true),
  (null, 'read_only', 'Read only', 'Lecture seule', 1|1024, true),
  (null, 'task_contributor', 'Task contributor', 'Collaborateur de la tâche', 1|2|4|512, true),
  (null, 'task_reviewer', 'Task reviewer', 'Réviseur de la tâche', 1|2|128, true),
  (null, 'task_approver', 'Task approver', 'Approbateur de la tâche', 1|2|128|256, true),
  (null, 'task_follower', 'Task follower', 'Abonné de la tâche', 1|1024, true),
  -- Workspace OS roles for sharing spaces and pages.
  (null, 'editor', 'Can edit', 'Peut modifier', 1|2|4, true),
  (null, 'commenter', 'Can comment', 'Peut commenter', 1|2, true),
  (null, 'viewer', 'Can view', 'Peut consulter', 1, true),
  (null, 'full_access', 'Full access', 'Accès complet', 127, true),
  (null, 'workspace_member', 'Workspace member', 'Membre de l’espace de travail', 1|2|4, true);

create or replace function app.builtin_role(p_key text)
returns uuid
language sql stable
set search_path = ''
as $$
  select r.id from public.access_role r where r.organization_id is null and r.key = p_key;
$$;

-- ---------------------------------------------------------------------------
-- Nodes
-- ---------------------------------------------------------------------------

create table app.access_node (
  id uuid primary key,
  organization_id uuid not null references public.organization (id) on delete cascade,
  kind text not null check (kind in ('space', 'project', 'task', 'object')),
  -- The kind of space when kind = 'space'.
  space_kind text check (space_kind in ('workspace', 'program', 'private', 'custom')),
  parent_id uuid references app.access_node (id) on delete set null,
  ancestors uuid[] not null,
  -- Under a private space: organization-wide roles do not reach it.
  in_private boolean not null default false,
  -- An archived workspace, custom or private space keeps only view and manage.
  archived boolean not null default false,
  check (ancestors[1] = id),
  check ((kind = 'space') = (space_kind is not null))
);
create index access_node_ancestors_gin on app.access_node using gin (ancestors);
create index access_node_parent_idx on app.access_node (parent_id) where parent_id is not null;
create index access_node_org_idx on app.access_node (organization_id);

alter table app.access_node enable row level security;
revoke all on app.access_node from public, anon, authenticated;
grant all on app.access_node to service_role;

comment on table app.access_node is
  'Workspace OS access: every securable thing with its parent chain (M10b). Kept by triggers; not reachable through the API.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

create table public.access_grant (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  object_id uuid not null references app.access_node (id) on delete cascade,
  principal_kind text not null check (principal_kind in ('person', 'team', 'org_role')),
  user_id uuid references public.user_profile (id) on delete cascade,
  team_id uuid,
  org_role public.org_role,
  role_id uuid not null references public.access_role (id) on delete cascade,
  reach text not null default 'subtree' check (reach in ('subtree', 'self', 'self_and_child_tasks')),
  -- 'direct' for grants people make; otherwise the column or table it
  -- mirrors (dual write) and, where there is one, that row's id.
  source text not null default 'direct',
  legacy_id uuid,
  created_by uuid references public.user_profile (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint access_grant_principal_shape check (
    (principal_kind = 'person' and user_id is not null and team_id is null and org_role is null)
    or (principal_kind = 'team' and team_id is not null and user_id is null and org_role is null)
    or (principal_kind = 'org_role' and org_role is not null and user_id is null and team_id is null)
  ),
  constraint access_grant_team_org_fk foreign key (team_id, organization_id)
    references public.team (id, organization_id) on delete cascade,
  constraint access_grant_unique unique nulls not distinct
    (object_id, principal_kind, user_id, team_id, org_role, role_id, source, legacy_id)
);
create index access_grant_object_idx on public.access_grant (object_id);
create index access_grant_user_idx on public.access_grant (user_id) where user_id is not null;
create index access_grant_team_idx on public.access_grant (team_id) where team_id is not null;
create index access_grant_role_idx on public.access_grant (organization_id, org_role) where principal_kind = 'org_role';
create index access_grant_legacy_idx on public.access_grant (source, legacy_id) where legacy_id is not null;

comment on table public.access_grant is
  'Workspace OS grants (M10b): a role on a node for a person, team or organization role. Rows with a source other than direct mirror today''s tables.';

-- ---------------------------------------------------------------------------
-- Keeping nodes: insert or move one node, rewriting descendants' chains.
-- ---------------------------------------------------------------------------

create or replace function app.access_put_node(
  p_id uuid, p_organization uuid, p_kind text, p_space_kind text, p_parent uuid, p_archived boolean default false
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_parent app.access_node%rowtype;
  v_chain uuid[];
  v_private boolean;
  v_old uuid[];
begin
  if p_parent is not null then
    select * into v_parent from app.access_node n where n.id = p_parent;
  end if;
  if v_parent.id is null or v_parent.organization_id <> p_organization or v_parent.ancestors @> array[p_id] then
    v_chain := array[p_id];
    v_private := p_space_kind = 'private';
    p_parent := null;
  else
    v_chain := array[p_id] || v_parent.ancestors;
    v_private := v_parent.in_private or p_space_kind = 'private';
  end if;
  v_private := coalesce(v_private, false);

  select n.ancestors into v_old from app.access_node n where n.id = p_id;
  insert into app.access_node (id, organization_id, kind, space_kind, parent_id, ancestors, in_private, archived)
  values (p_id, p_organization, p_kind, p_space_kind, p_parent, v_chain, v_private, coalesce(p_archived, false))
  on conflict (id) do update
    set parent_id = excluded.parent_id,
        ancestors = excluded.ancestors,
        in_private = excluded.in_private,
        archived = excluded.archived
    where (app.access_node.parent_id, app.access_node.ancestors, app.access_node.in_private, app.access_node.archived)
      is distinct from (excluded.parent_id, excluded.ancestors, excluded.in_private, excluded.archived);

  -- A move: everything under it keeps its own part of the chain and takes
  -- the new part from this node up.
  if v_old is not null and v_old is distinct from v_chain then
    update app.access_node d
    set ancestors = d.ancestors[1:array_position(d.ancestors, p_id) - 1] || v_chain,
        in_private = v_private or exists (
          select 1 from app.access_node s
          where s.id = any (d.ancestors[1:array_position(d.ancestors, p_id) - 1])
            and s.space_kind = 'private')
    where d.ancestors @> array[p_id] and d.id <> p_id;
  end if;
end;
$$;

-- Replace the one grant a column gives (a lead, an owner, a task actor).
create or replace function app.access_put_column_grant(
  p_organization uuid, p_object uuid, p_source text, p_user uuid, p_role text, p_reach text default 'subtree'
)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.access_grant g
  where g.object_id = p_object and g.source = p_source and g.legacy_id = p_object
    and g.user_id is distinct from p_user;
  if p_user is not null and exists (select 1 from app.access_node n where n.id = p_object) then
    insert into public.access_grant
      (organization_id, object_id, principal_kind, user_id, role_id, reach, source, legacy_id, created_by)
    values (p_organization, p_object, 'person', p_user, app.builtin_role(p_role), p_reach, p_source, p_object, null)
    on conflict do nothing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Spaces (M10a) as nodes
-- ---------------------------------------------------------------------------

create or replace function app.access_sync_space(s public.space)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.access_put_node(s.id, s.organization_id, 'space', s.kind, null,
    s.kind <> 'program' and s.archived_at is not null);
  if s.kind = 'private' then
    perform app.access_put_column_grant(s.organization_id, s.id, 'space.owner_id', s.owner_id, 'manager');
  elsif s.kind = 'workspace' then
    insert into public.access_grant
      (organization_id, object_id, principal_kind, org_role, role_id, source, legacy_id, created_by)
    values (s.organization_id, s.id, 'org_role', 'staff', app.builtin_role('workspace_member'), 'space.default', s.id, null)
    on conflict do nothing;
  end if;
end;
$$;

create or replace function app.access_on_space()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.access_sync_space(new);
  return null;
end;
$$;

create trigger zz_access_sync after insert or update of archived_at on public.space
  for each row execute function app.access_on_space();

-- ---------------------------------------------------------------------------
-- Programs, projects, tasks
-- ---------------------------------------------------------------------------

create or replace function app.access_ensure_program(p_program uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_program public.program%rowtype;
begin
  if p_program is null or exists (select 1 from app.access_node n where n.id = p_program) then
    return;
  end if;
  select * into v_program from public.program p where p.id = p_program;
  if found then
    perform app.access_put_node(v_program.id, v_program.organization_id, 'space', 'program', null);
    perform app.access_put_column_grant(v_program.organization_id, v_program.id, 'program.lead_id',
      v_program.lead_id, 'manager', 'self_and_child_tasks');
  end if;
end;
$$;

create or replace function app.access_sync_project(p public.project)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.access_ensure_program(p.program_id);
  perform app.access_put_node(p.id, p.organization_id, 'project', null, p.program_id);
  perform app.access_put_column_grant(p.organization_id, p.id, 'project.owner_id', p.owner_id, 'manager');
end;
$$;

create or replace function app.access_ensure_project(p_project uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_project is not null and not exists (select 1 from app.access_node n where n.id = p_project) then
    perform app.access_sync_project(p) from public.project p where p.id = p_project;
  end if;
end;
$$;

create or replace function app.access_on_program()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from app.access_node where id = old.id;
    return null;
  end if;
  perform app.access_ensure_program(new.id);
  perform app.access_put_column_grant(new.organization_id, new.id, 'program.lead_id',
    new.lead_id, 'manager', 'self_and_child_tasks');
  return null;
end;
$$;

create or replace function app.access_on_project()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from app.access_node where id = old.id;
    return null;
  end if;
  perform app.access_sync_project(new);
  return null;
end;
$$;

-- Tasks are written a statement at a time (the spike's bulk-insert finding):
-- one pass over the new rows places them and rewrites their column grants.
create or replace function app.access_sync_tasks(p_tasks uuid[])
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_missing uuid;
begin
  for v_missing in
    select distinct t.project_id from public.task t
    where t.id = any (p_tasks) and t.project_id is not null
      and not exists (select 1 from app.access_node n where n.id = t.project_id)
  loop
    perform app.access_ensure_project(v_missing);
  end loop;
  for v_missing in
    select distinct t.program_id from public.task t
    where t.id = any (p_tasks) and t.project_id is null and t.program_id is not null
      and not exists (select 1 from app.access_node n where n.id = t.program_id)
  loop
    perform app.access_ensure_program(v_missing);
  end loop;

  -- Tasks that moved (or have pages under them) go one at a time so their
  -- descendants are rewritten; new and unmoved tasks go in one statement.
  perform app.access_put_node(t.id, t.organization_id, 'task', null, coalesce(t.project_id, t.program_id))
  from public.task t
  join app.access_node n on n.id = t.id
  where t.id = any (p_tasks)
    and n.parent_id is distinct from coalesce(t.project_id, t.program_id);

  insert into app.access_node (id, organization_id, kind, parent_id, ancestors, in_private)
  select t.id, t.organization_id, 'task', p.id,
         case when p.id is null then array[t.id] else array[t.id] || p.ancestors end,
         coalesce(p.in_private, false)
  from public.task t
  left join app.access_node p
    on p.id = coalesce(t.project_id, t.program_id) and p.organization_id = t.organization_id
  where t.id = any (p_tasks)
  on conflict (id) do nothing;

  delete from public.access_grant g
  where g.object_id = any (p_tasks)
    and g.source in ('task.assignee_id', 'task.requester_id', 'task.reviewer_id', 'task.approver_id');

  insert into public.access_grant
    (organization_id, object_id, principal_kind, user_id, role_id, source, legacy_id, created_by)
  select t.organization_id, t.id, 'person', c.user_id, app.builtin_role(c.role_key), c.source, t.id, null
  from public.task t
  cross join lateral (values
    (t.assignee_id, 'task_contributor', 'task.assignee_id'),
    (t.requester_id, 'task_contributor', 'task.requester_id'),
    (t.reviewer_id, 'task_approver', 'task.reviewer_id'),
    (t.approver_id, 'task_approver', 'task.approver_id')
  ) as c (user_id, role_key, source)
  where t.id = any (p_tasks) and c.user_id is not null
  on conflict do nothing;
end;
$$;

create or replace function app.access_on_task_insert()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.access_sync_tasks(array(select id from new_rows));
  return null;
end;
$$;

create or replace function app.access_on_task_update()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.access_sync_tasks(array(
    select n.id from new_rows n join old_rows o on o.id = n.id
    where (n.organization_id, n.project_id, n.program_id, n.assignee_id, n.requester_id, n.reviewer_id, n.approver_id)
      is distinct from (o.organization_id, o.project_id, o.program_id, o.assignee_id, o.requester_id, o.reviewer_id, o.approver_id)));
  return null;
end;
$$;

create or replace function app.access_on_task_delete()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from app.access_node n where n.id in (select id from old_rows);
  return null;
end;
$$;

-- Named zz_ so they run after the existing triggers on these tables (the
-- program space from M10a must exist first).
create trigger zz_access_sync after insert or update of organization_id, lead_id or delete on public.program
  for each row execute function app.access_on_program();
create trigger zz_access_sync after insert or update of organization_id, program_id, owner_id or delete on public.project
  for each row execute function app.access_on_project();
create trigger zz_access_sync_insert after insert on public.task
  referencing new table as new_rows
  for each statement execute function app.access_on_task_insert();
create trigger zz_access_sync_update after update on public.task
  referencing old table as old_rows new table as new_rows
  for each statement execute function app.access_on_task_update();
create trigger zz_access_sync_delete after delete on public.task
  referencing old table as old_rows
  for each statement execute function app.access_on_task_delete();

-- ---------------------------------------------------------------------------
-- Today's grant tables
-- ---------------------------------------------------------------------------

create or replace function app.access_program_role(p_role public.program_access_role)
returns text language sql immutable set search_path = ''
as $$
  select case p_role
    when 'lead' then 'manager' when 'manager' then 'manager'
    when 'contributor' then 'contributor' when 'reviewer' then 'reviewer'
    when 'follower' then 'follower' when 'read_only' then 'read_only'
  end;
$$;

create or replace function app.access_project_role(p_role public.project_access_role)
returns text language sql immutable set search_path = ''
as $$
  select case p_role
    when 'project_manager' then 'manager' when 'contributor' then 'contributor'
    when 'reviewer' then 'reviewer' when 'approver' then 'approver'
    when 'follower' then 'follower' when 'read_only' then 'read_only'
  end;
$$;

create or replace function app.access_on_legacy_grant()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'UPDATE') then
    if tg_table_name = 'task_assignment' then
      delete from public.access_grant g
      where g.object_id = old.task_id and g.user_id = old.user_id and g.source = 'task_assignment'
        and g.role_id = app.builtin_role('task_' || old.role);
    else
      delete from public.access_grant g where g.source = tg_table_name and g.legacy_id = old.id;
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if tg_table_name = 'program_access_grant' then
      perform app.access_ensure_program(new.program_id);
      insert into public.access_grant
        (organization_id, object_id, principal_kind, user_id, role_id, source, legacy_id, created_by)
      values (new.organization_id, new.program_id, 'person', new.user_id,
              app.builtin_role(app.access_program_role(new.role)), tg_table_name, new.id, null)
      on conflict do nothing;
    elsif tg_table_name = 'project_access_grant' then
      if new.source <> 'program_inherited' then
        perform app.access_ensure_project(new.project_id);
        insert into public.access_grant
          (organization_id, object_id, principal_kind, user_id, role_id, source, legacy_id, created_by)
        values (new.organization_id, new.project_id, 'person', new.user_id,
                app.builtin_role(app.access_project_role(new.role)), tg_table_name, new.id, null)
        on conflict do nothing;
      end if;
    else
      insert into public.access_grant
        (organization_id, object_id, principal_kind, user_id, role_id, source, created_by)
      select t.organization_id, t.id, 'person', new.user_id, app.builtin_role('task_' || new.role), 'task_assignment', null
      from public.task t
      where t.id = new.task_id and exists (select 1 from app.access_node n where n.id = t.id)
      on conflict do nothing;
    end if;
  end if;
  return null;
end;
$$;

create trigger zz_access_sync after insert or update or delete on public.program_access_grant
  for each row execute function app.access_on_legacy_grant();
create trigger zz_access_sync after insert or update or delete on public.project_access_grant
  for each row execute function app.access_on_legacy_grant();
create trigger zz_access_sync after insert or update or delete on public.task_assignment
  for each row execute function app.access_on_legacy_grant();

-- ---------------------------------------------------------------------------
-- Workspace OS objects (S1's registry), when it exists. Native types are
-- placed from their own tables above; the rest by parent, else space.
-- ---------------------------------------------------------------------------

create or replace function app.access_on_object()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_native boolean;
begin
  if tg_op = 'DELETE' then
    delete from app.access_node n where n.id = old.id and n.kind = 'object';
    return null;
  end if;
  execute 'select coalesce((select t.kind = ''native'' from public.object_type t where t.id = $1), false)'
    into v_native using new.type_id;
  if v_native then
    return null;
  end if;
  if new.deleted_at is not null then
    delete from app.access_node n where n.id = new.id and n.kind = 'object';
    return null;
  end if;
  perform app.access_put_node(new.id, new.organization_id, 'object', null,
    coalesce(new.parent_object_id, new.space_id));
  perform app.access_put_column_grant(new.organization_id, new.id, 'object.owner_id', new.owner_id, 'manager');
  return null;
end;
$$;

create or replace function app.access_attach_object_registry()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  if to_regclass('public.object') is null then
    return;
  end if;
  execute 'drop trigger if exists zz_access_sync on public.object';
  execute 'create trigger zz_access_sync
    after insert or delete or update of parent_object_id, space_id, owner_id, deleted_at, organization_id
    on public.object for each row execute function app.access_on_object()';
  -- Parents before children, so every chain is complete.
  for v_row in execute $sql$
    with recursive tree as (
      select o.id, 0 as depth from public.object o where o.parent_object_id is null
      union all
      select c.id, tree.depth + 1 from public.object c join tree on c.parent_object_id = tree.id
      where tree.depth < 1000
    )
    select o.id, o.organization_id, coalesce(o.parent_object_id, o.space_id) as parent, o.owner_id
    from tree
    join public.object o on o.id = tree.id
    join public.object_type t on t.id = o.type_id
    where t.kind <> 'native' and o.deleted_at is null
    order by tree.depth
  $sql$ loop
    perform app.access_put_node(v_row.id, v_row.organization_id, 'object', null, v_row.parent);
    perform app.access_put_column_grant(v_row.organization_id, v_row.id, 'object.owner_id', v_row.owner_id, 'manager');
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- The live answer (M10c replaces the grant part with the cache).
-- ---------------------------------------------------------------------------

-- Bits a person holds on a node through person, team and organization-role
-- grants on the node and, as their reach allows, its ancestors.
create or replace function app.access_grant_bits(p_node uuid, p_user uuid)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select coalesce(bit_or(r.caps), 0)::integer
  from app.access_node o
  cross join lateral unnest(o.ancestors) with ordinality as a (id, depth)
  join public.access_grant g
    on g.object_id = a.id
   and g.organization_id = o.organization_id
   and (a.depth = 1 or g.reach = 'subtree'
        or (g.reach = 'self_and_child_tasks' and a.depth = 2 and o.kind = 'task'))
  join public.access_role r on r.id = g.role_id
  join public.organization_membership m
    on m.organization_id = o.organization_id and m.user_id = p_user and m.status = 'active'
  where o.id = p_node
    and (
      (g.principal_kind = 'person' and g.user_id = p_user)
      or (g.principal_kind = 'org_role' and g.org_role = m.role)
      or (g.principal_kind = 'team' and exists (
        select 1 from public.team_member tm where tm.team_id = g.team_id and tm.user_id = p_user))
    );
$$;

-- Everything live around the grants: membership, the organization-wide
-- roles, two-step sign-in, private spaces and archived spaces. One place, so
-- the cached and uncached forms cannot drift apart.
create or replace function app.access_finish_bits(
  p_role public.org_role, p_aal2 boolean, p_in_private boolean, p_archived boolean, p_grant_bits integer
)
returns integer
language sql immutable parallel safe
set search_path = ''
as $$
  select (
    (coalesce(p_grant_bits, 0)
      | case
          when p_in_private then 0
          when p_role in ('owner', 'admin') then case when p_aal2 then 2047 else 1 end
          when p_role = 'leadership_viewer' then 1
          else 0
        end)
    & case
        when p_role in ('owner', 'admin') and not p_aal2 then 1
        when p_role = 'leadership_viewer' then 1
        else 2047
      end
    & case when p_archived then 1 | 16 else 2047 end
  )::integer;
$$;

create or replace function app.access_bits(p_node uuid)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select app.access_finish_bits(
      m.role,
      coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2',
      n.in_private, n.archived,
      app.access_grant_bits(n.id, m.user_id))
    from app.access_node n
    join public.organization_membership m
      on m.organization_id = n.organization_id
     and m.user_id = (select auth.uid())
     and m.status = 'active'
    where n.id = p_node
  ), 0);
$$;

-- M10a's space check, now answered by the model.
create or replace function app.space_capabilities(p_space uuid)
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select app.bits_to_caps(app.access_bits(p_space));
$$;

create or replace function public.object_capabilities(object_id uuid)
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select app.bits_to_caps(app.access_bits(object_id));
$$;

revoke all on function app.cap_bit(text), app.wos_bits(), app.all_bits(), app.caps_to_bits(text[]),
  app.bits_to_caps(integer), app.builtin_role(text), app.access_put_node(uuid, uuid, text, text, uuid, boolean),
  app.access_put_column_grant(uuid, uuid, text, uuid, text, text), app.access_sync_space(public.space),
  app.access_on_space(), app.access_ensure_program(uuid), app.access_sync_project(public.project),
  app.access_ensure_project(uuid), app.access_on_program(), app.access_on_project(),
  app.access_sync_tasks(uuid[]), app.access_on_task_insert(), app.access_on_task_update(),
  app.access_on_task_delete(), app.access_program_role(public.program_access_role),
  app.access_project_role(public.project_access_role), app.access_on_legacy_grant(), app.access_on_object(),
  app.access_attach_object_registry(), app.access_grant_bits(uuid, uuid),
  app.access_finish_bits(public.org_role, boolean, boolean, boolean, integer), app.access_bits(uuid)
  from public, anon, authenticated;
grant execute on function app.cap_bit(text), app.bits_to_caps(integer), app.caps_to_bits(text[]),
  app.access_bits(uuid), app.access_grant_bits(uuid, uuid) to service_role;
-- Policies call it as the signed-in role (like app.is_org_member); the app
-- schema is not exposed through the API.
grant execute on function app.access_bits(uuid) to authenticated;
revoke all on function public.object_capabilities(uuid) from public, anon;
grant execute on function public.object_capabilities(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Backfill: every space, program, project and task, then today's grants.
-- ---------------------------------------------------------------------------

select app.access_sync_space(s) from public.space s where s.kind <> 'program';
select app.access_ensure_program(p.id) from public.program p;
select app.access_sync_project(p) from public.project p;
select app.access_sync_tasks(array_agg(t.id)) from public.task t having count(*) > 0;

insert into public.access_grant (organization_id, object_id, principal_kind, user_id, role_id, source, legacy_id, created_by)
select g.organization_id, g.program_id, 'person', g.user_id,
       app.builtin_role(app.access_program_role(g.role)), 'program_access_grant', g.id, null
from public.program_access_grant g
on conflict do nothing;

insert into public.access_grant (organization_id, object_id, principal_kind, user_id, role_id, source, legacy_id, created_by)
select g.organization_id, g.project_id, 'person', g.user_id,
       app.builtin_role(app.access_project_role(g.role)), 'project_access_grant', g.id, null
from public.project_access_grant g
where g.source <> 'program_inherited'
on conflict do nothing;

insert into public.access_grant (organization_id, object_id, principal_kind, user_id, role_id, source, created_by)
select t.organization_id, t.id, 'person', ta.user_id, app.builtin_role('task_' || ta.role), 'task_assignment', null
from public.task_assignment ta join public.task t on t.id = ta.task_id
on conflict do nothing;

select app.access_attach_object_registry();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.access_role enable row level security;
alter table public.access_grant enable row level security;

-- Built-in roles are readable by every signed-in member; custom roles by
-- their organization (written in M10d).
create policy access_role_read on public.access_role
  for select to authenticated
  using (organization_id is null or app.is_org_member(organization_id));

-- Anyone who can see a node sees who has access to it, as a share menu does.
create policy access_grant_read on public.access_grant
  for select to authenticated
  using (app.is_org_member(organization_id) and app.access_bits(object_id) & 1 <> 0);

-- People write direct grants only, and only where they may share, with a
-- role that gives no more than they hold. Native records (tasks, projects,
-- program spaces) keep today's tables as their source; private spaces stay
-- private (their pages can be shared one by one).
create or replace function app.access_can_write_grant(p_object uuid, p_role uuid, p_organization uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.is_org_member(p_organization)
    and exists (
      select 1 from app.access_node n
      where n.id = p_object and n.organization_id = p_organization
        and (n.kind = 'object' or (n.kind = 'space' and n.space_kind in ('workspace', 'custom'))))
    and app.access_bits(p_object) & 64 <> 0
    and exists (
      select 1 from public.access_role r
      where r.id = p_role and (r.organization_id is null or r.organization_id = p_organization)
        and r.caps & ~127 = 0
        and r.caps & ~app.access_bits(p_object) = 0);
$$;
revoke all on function app.access_can_write_grant(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function app.access_can_write_grant(uuid, uuid, uuid) to authenticated, service_role;

create policy access_grant_insert on public.access_grant
  for insert to authenticated
  with check (source = 'direct' and legacy_id is null
    and app.access_can_write_grant(object_id, role_id, organization_id));

create policy access_grant_update on public.access_grant
  for update to authenticated
  using (source = 'direct' and app.access_can_write_grant(object_id, role_id, organization_id))
  with check (source = 'direct' and app.access_can_write_grant(object_id, role_id, organization_id));

create policy access_grant_delete on public.access_grant
  for delete to authenticated
  using (source = 'direct' and app.access_bits(object_id) & 64 <> 0);

-- A person grant goes to an active member of the grant's organization.
create or replace function app.validate_access_grant()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.principal_kind = 'person' and new.source = 'direct' and not exists (
    select 1 from public.organization_membership m
    where m.organization_id = new.organization_id and m.user_id = new.user_id and m.status = 'active') then
    raise exception 'Grants go to active members of the organization.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (new.object_id, new.principal_kind, new.user_id, new.team_id, new.org_role, new.source, new.organization_id)
       is distinct from (old.object_id, old.principal_kind, old.user_id, old.team_id, old.org_role, old.source, old.organization_id) then
    raise exception 'Only a grant''s role and reach can change.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.validate_access_grant() from public, anon, authenticated;

create trigger access_grant_validate
  before insert or update on public.access_grant
  for each row execute function app.validate_access_grant();

revoke all on public.access_role, public.access_grant from anon, authenticated;
grant select on public.access_role to authenticated;
grant select, delete on public.access_grant to authenticated;
grant insert (organization_id, object_id, principal_kind, user_id, team_id, org_role, role_id, reach)
  on public.access_grant to authenticated;
grant update (role_id, reach) on public.access_grant to authenticated;
grant all on public.access_role, public.access_grant to service_role;
