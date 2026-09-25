-- CRM sensitive notes, readable only by the relationship owner or an
-- administrator (#38 P1-CRM-02, security requirement).
--
-- `sensitive_notes` was a column on crm_organization and crm_contact. Both
-- tables are readable by every staff member (app.can_access_crm), so any of
-- them could select the column straight from the API; the interface merely
-- declined to ask for it, and 20260926020000 only guarded changes. #38 asks
-- for exactly the opposite of that: "do not rely on column-level secrecy
-- where row-level RLS exposes the row."
--
-- The notes move to their own table whose rows are only visible to the
-- owner of the organization or contact they belong to, or an administrator
-- of that tenant. Everything else keeps reading crm_organization and
-- crm_contact as before, and those tables no longer hold anything private.

create table if not exists public.crm_sensitive_note (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  crm_organization_id uuid unique references public.crm_organization (id) on delete cascade,
  crm_contact_id uuid unique references public.crm_contact (id) on delete cascade,
  notes text not null check (length(notes) between 1 and 5000),
  updated_by uuid references public.user_profile (id),
  updated_at timestamptz not null default now(),
  constraint crm_sensitive_note_one_subject
    check (num_nonnulls(crm_organization_id, crm_contact_id) = 1)
);

-- Whether the caller may read or write the note of this organization or
-- contact: it must belong to p_org, and the caller must own it or administer
-- p_org. A note cannot be attached to another tenant's record.
create or replace function app.can_access_crm_sensitive_note(
  p_org uuid,
  p_crm_organization uuid,
  p_crm_contact uuid
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select app.can_read_crm_sensitive(s.owner_id, s.organization_id)
    from (
      select o.owner_id, o.organization_id
      from public.crm_organization o
      where o.id = p_crm_organization
      union all
      select c.owner_id, c.organization_id
      from public.crm_contact c
      where c.id = p_crm_contact
    ) s
    where s.organization_id = p_org
    limit 1
  ), false);
$$;

revoke all on function app.can_access_crm_sensitive_note(uuid, uuid, uuid) from public, anon;
grant execute on function app.can_access_crm_sensitive_note(uuid, uuid, uuid)
  to authenticated, service_role;

alter table public.crm_sensitive_note enable row level security;

create policy crm_sensitive_note_read on public.crm_sensitive_note
  for select to authenticated
  using (app.can_access_crm_sensitive_note(organization_id, crm_organization_id, crm_contact_id));
create policy crm_sensitive_note_insert on public.crm_sensitive_note
  for insert to authenticated
  with check (app.can_access_crm_sensitive_note(organization_id, crm_organization_id, crm_contact_id));
create policy crm_sensitive_note_update on public.crm_sensitive_note
  for update to authenticated
  using (app.can_access_crm_sensitive_note(organization_id, crm_organization_id, crm_contact_id))
  with check (app.can_access_crm_sensitive_note(organization_id, crm_organization_id, crm_contact_id));
create policy crm_sensitive_note_delete on public.crm_sensitive_note
  for delete to authenticated
  using (app.can_access_crm_sensitive_note(organization_id, crm_organization_id, crm_contact_id));

grant select, insert, update, delete on public.crm_sensitive_note to authenticated;

-- Carry existing notes across, then remove the readable columns.
insert into public.crm_sensitive_note (organization_id, crm_organization_id, notes)
select organization_id, id, sensitive_notes
from public.crm_organization
where nullif(trim(sensitive_notes), '') is not null
on conflict do nothing;

insert into public.crm_sensitive_note (organization_id, crm_contact_id, notes)
select organization_id, id, sensitive_notes
from public.crm_contact
where nullif(trim(sensitive_notes), '') is not null
on conflict do nothing;

drop trigger if exists crm_organization_sensitive on public.crm_organization;
drop trigger if exists crm_contact_sensitive on public.crm_contact;
drop function if exists app.protect_crm_sensitive_notes();

alter table public.crm_organization drop column if exists sensitive_notes;
alter table public.crm_contact drop column if exists sensitive_notes;
