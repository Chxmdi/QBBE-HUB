-- P0-FIL-01: external document links must point at an approved source.
--
-- The requirement is that people attach links to "Google Drive or another
-- QBBE-controlled source". Until now the only thing expressing that was a
-- placeholder in the upload dialog reading "https://drive.google.com/…".
-- `linkSchema` accepted `z.string().url()`, which is any URL at all — including
-- `javascript:` and `data:`, both of which `new URL()` parses happily, and
-- including any third-party host somebody cared to paste.
--
-- That matters beyond tidiness. `getDocumentDownloadUrl` returns a link
-- document's stored URL verbatim and the list opens it with `window.open`, so
-- whatever was saved is what a colleague's browser is sent to. A library that
-- looks curated but accepts anything is worse than one that never promised.
--
-- The allowlist lives in a table rather than in application code because it is
-- a policy an administrator changes, not a constant a deployment changes, and
-- it is enforced by a trigger rather than only by the form because a form is
-- not a control: PostgREST is reachable directly.

create table if not exists public.approved_document_host (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  -- Stored bare and lowercase: no scheme, no path, no trailing dot.
  host text not null,
  label text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references public.user_profile (id),
  constraint approved_document_host_shape
    check (host = lower(host) and host !~ '[/:\s]' and length(host) between 3 and 253),
  constraint approved_document_host_unique unique (organization_id, host)
);

create index if not exists approved_document_host_org_idx
  on public.approved_document_host (organization_id);

alter table public.approved_document_host enable row level security;

-- Everyone who can see the library can see what it will accept, so the form can
-- say so before somebody types a link it is going to refuse.
drop policy if exists approved_document_host_read on public.approved_document_host;
create policy approved_document_host_read on public.approved_document_host
  for select using (app.is_org_member(organization_id));

-- Changing what counts as an approved source is an administrative act, and an
-- administrative act inside one organization. `app.is_admin()` would have asked
-- only whether the caller administers *something*, which would have let an
-- administrator of one organization widen another's allowlist — the exact hole
-- the policy scoping check in `rls.sql` exists to catch, and did.
drop policy if exists approved_document_host_write on public.approved_document_host;
create policy approved_document_host_write on public.approved_document_host
  for all
  using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id));

-- ---------------------------------------------------------------------------
-- The enforcement
-- ---------------------------------------------------------------------------

/**
 * The host of an https URL, lowercased, or null if it is not an https URL.
 *
 * Deliberately strict about the scheme rather than stripping whatever prefix
 * is present. `javascript:` and `data:` are the reason: both are valid URLs to
 * a parser, neither belongs in a document library, and an allowlist that only
 * checks the host would pass `javascript:alert(1)` because it has no host to
 * disagree with.
 */
create or replace function app.approved_link_host(candidate text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(substring(candidate from '^https://([^/?#]+)'));
$$;

create or replace function app.reject_unapproved_document_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate_host text;
begin
  if new.kind <> 'link' or new.url is null then
    return new;
  end if;

  candidate_host := app.approved_link_host(new.url);

  if candidate_host is null then
    raise exception
      'A resource link must be an https address. Received: %', left(new.url, 60)
      using errcode = 'check_violation';
  end if;

  -- A host is approved for the organization the document belongs to, not
  -- globally. Two organizations sharing this deployment do not share a view of
  -- what counts as their own Drive.
  if not exists (
    select 1
      from public.approved_document_host h
     where h.organization_id = new.organization_id
       and h.host = candidate_host
  ) then
    raise exception
      '% is not an approved source for external resources.', candidate_host
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists document_link_host_approved on public.document;
create trigger document_link_host_approved
  before insert or update of url, kind, organization_id on public.document
  for each row execute function app.reject_unapproved_document_link();

-- ---------------------------------------------------------------------------
-- Seed, and the existing rows
-- ---------------------------------------------------------------------------

-- Google Drive is what the dialog has been suggesting all along, so it is what
-- every existing organization starts with. Anything else an organization uses
-- is for an administrator to add, which is the point of the table.
insert into public.approved_document_host (organization_id, host, label)
select o.id, h.host, h.label
  from public.organization o
 cross join (values
   ('drive.google.com', 'Google Drive'),
   ('docs.google.com', 'Google Docs'),
   ('sheets.google.com', 'Google Sheets'),
   ('slides.google.com', 'Google Slides')
 ) as h(host, label)
on conflict (organization_id, host) do nothing;

-- A new organization has to start with the same defaults, or it would be
-- created unable to save any external link at all until an administrator
-- noticed and configured one. The seed above only reaches organizations that
-- existed when this migration ran.
create or replace function app.seed_approved_document_hosts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.approved_document_host (organization_id, host, label)
  select new.id, h.host, h.label
    from (values
      ('drive.google.com', 'Google Drive'),
      ('docs.google.com', 'Google Docs'),
      ('sheets.google.com', 'Google Sheets'),
      ('slides.google.com', 'Google Slides')
    ) as h(host, label)
  on conflict (organization_id, host) do nothing;
  return new;
end;
$$;

drop trigger if exists organization_seed_approved_hosts on public.organization;
create trigger organization_seed_approved_hosts
  after insert on public.organization
  for each row execute function app.seed_approved_document_hosts();

-- Existing link rows are left exactly as they are. The trigger fires on insert
-- and on update of the columns it cares about, so nothing already stored is
-- rewritten or deleted here: a link that predates the policy keeps working
-- until somebody edits it, and deciding what to do about those is an
-- administrator's call rather than a migration's.
--
-- Whether any such rows exist is worth knowing rather than guessing, so this
-- reports them instead of staying silent.
do $$
declare
  stragglers int;
begin
  select count(*) into stragglers
    from public.document d
   where d.kind = 'link'
     and d.url is not null
     and not exists (
       select 1
         from public.approved_document_host h
        where h.organization_id = d.organization_id
          and h.host = app.approved_link_host(d.url)
     );
  if stragglers > 0 then
    raise notice
      '% existing link document(s) point at a host that is not approved. They are unchanged and still readable; editing one will now require an approved host.',
      stragglers;
  end if;
end;
$$;
