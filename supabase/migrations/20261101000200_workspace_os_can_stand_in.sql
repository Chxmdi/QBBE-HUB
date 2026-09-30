-- Workspace OS: `app.can` stand-in (W0-3, epic #199).
--
-- The plan (workspace-os-plan.md A6) makes one check, app.can(object, capability),
-- the only access question every new layer asks. The real one arrives with
-- spaces and cached grants in M10c (stream S2). Until then this stand-in gives
-- every stream the final signature with today's answers, so RLS policies,
-- lenses and actions can be written against it now and never change.
--
-- It knows two kinds of object, the two that exist before the object registry
-- (M1): tasks and projects. For those it asks exactly the existing authoritative
-- predicates, app.has_task_capability and app.has_project_capability, so it can
-- never be more open than the rules in force. Anything else (an unknown id, an
-- unknown capability, a signed-out caller) is false.
--
-- Workspace OS capability names map onto today's record capabilities
-- (src/lib/access-capabilities.ts) as below. Where today's rules are wider
-- than a Workspace OS capability needs, the map takes the narrower reading:
--
--   view            read
--   comment         manage, collaborate, review or approve  (task_comment_insert)
--   edit_content    manage or collaborate                   (reviewers only decide)
--   edit_structure  manage
--   manage          manage
--   share           manage
--   run_workflow    manage
--
-- Today's names (read, collaborate, review, approve, follow) are accepted too
-- and passed through unchanged, so a caller can move to app.can before it
-- moves to the new vocabulary.
--
-- The owner/admin two-step sign-in (AAL2) requirement for everything but read
-- is inherited from the delegated predicates, not repeated here.

create or replace function app.can(object_id uuid, capability text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_needed text[];
  v_capability text;
begin
  if (select auth.uid()) is null or can.object_id is null then
    return false;
  end if;

  v_needed := case lower(coalesce(can.capability, ''))
    when 'view' then array['read']
    when 'comment' then array['manage', 'collaborate', 'review', 'approve']
    when 'edit_content' then array['manage', 'collaborate']
    when 'edit_structure' then array['manage']
    when 'manage' then array['manage']
    when 'share' then array['manage']
    when 'run_workflow' then array['manage']
    when 'read' then array['read']
    when 'collaborate' then array['collaborate']
    when 'review' then array['review']
    when 'approve' then array['approve']
    when 'follow' then array['follow']
    else array[]::text[]
  end;

  if exists (select 1 from public.task t where t.id = can.object_id) then
    foreach v_capability in array v_needed loop
      if app.has_task_capability(can.object_id, v_capability) then
        return true;
      end if;
    end loop;
    return false;
  end if;

  if exists (select 1 from public.project p where p.id = can.object_id) then
    foreach v_capability in array v_needed loop
      if app.has_project_capability(can.object_id, v_capability) then
        return true;
      end if;
    end loop;
    return false;
  end if;

  return false;
end;
$$;

-- Supabase's API only exposes the public schema, so the app and RLS policies
-- reach the check through this wrapper, as they do has_task_capability.
create or replace function public.can(object_id uuid, capability text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.can(object_id, capability);
$$;

-- Same split as has_task_capability: RLS policies and the app call the public
-- wrapper; the app schema itself is not open to signed-in roles.
revoke all on function app.can(uuid, text) from public, anon, authenticated;
revoke all on function public.can(uuid, text) from public, anon;
grant execute on function app.can(uuid, text) to service_role;
grant execute on function public.can(uuid, text) to authenticated, service_role;

comment on function app.can(uuid, text) is
  'Workspace OS access check. Stand-in until M10c: tasks and projects only, '
  'delegating to has_task_capability / has_project_capability; everything else '
  'is denied.';
comment on function public.can(uuid, text) is
  'API wrapper for app.can.';
