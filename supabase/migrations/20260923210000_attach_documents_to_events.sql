-- ---------------------------------------------------------------------------
-- Files can belong to an event (#32, P0-EVT-01).
--
-- P0-EVT-01 asks an event to hold "preparation checklist, and relevant files".
-- `document` could be linked to a program, a project, a channel, a meeting or
-- a CRM organization — and not to an event. So the run sheet, the venue
-- contract and the permit had nowhere to live except unattached in the
-- library, which is the one place nobody looks when they are standing at the
-- venue.
--
-- Two things have to change together, and the second is the one that matters.
--
-- `app.can_read_document` decides who may read a document by asking about
-- whichever thing it is linked to. Adding a column without adding a branch
-- would make an event-linked document readable by its owner and administrators
-- only, which is not useful; adding the branch without amending the final
-- clause would be worse. That clause grants organization-wide visibility to a
-- document linked to nothing, and it recognises "linked to nothing" by listing
-- every link column as null. A new column not named there would leave every
-- event document matching it, so an event's files would be visible to the
-- whole organization regardless of who may read the event. The clause names
-- `event_id` for exactly that reason.
-- ---------------------------------------------------------------------------

alter table public.document
  add column if not exists event_id uuid references public.event (id) on delete set null;

comment on column public.document.event_id is
  'The event this file belongs to, if any (P0-EVT-01). Read access follows app.can_read_event.';

create index if not exists idx_document_event on public.document (event_id)
  where event_id is not null;

create or replace function app.can_read_document(p_document uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.document d
    join public.organization_membership mem
      on mem.organization_id = d.organization_id
     and mem.user_id = (select auth.uid())
     and mem.status = 'active'
    where d.id = p_document
      and (
        mem.role in ('owner', 'admin', 'leadership_viewer')
        or d.owner_id = (select auth.uid())
        or d.created_by = (select auth.uid())
        or (
          d.project_id is not null
          and app.has_project_capability(d.project_id, 'read')
        )
        or (
          d.program_id is not null
          and app.has_program_capability(d.program_id, 'read')
        )
        or (
          d.meeting_id is not null
          and app.can_read_meeting(d.meeting_id)
        )
        or (
          d.event_id is not null
          and app.can_read_event(d.event_id)
        )
        or (
          d.crm_organization_id is not null
          and app.can_access_crm(d.organization_id)
        )
        or (
          d.visibility = 'organization'
          and d.program_id is null
          and d.project_id is null
          and d.meeting_id is null
          and d.event_id is null
          and d.crm_organization_id is null
          and app.is_org_member(d.organization_id)
        )
      )
  );
$$;
