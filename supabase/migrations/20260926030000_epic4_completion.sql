-- Epic 4 completion: project funding source, grant/agreement links, and a
-- small agreement record. New columns only — existing tables stay intact.

alter table public.project
  add column if not exists funding_source_id uuid references public.crm_organization (id) on delete set null;

alter table public.crm_link
  add column if not exists opportunity_id uuid references public.opportunity (id) on delete cascade,
  add column if not exists agreement_id uuid;

create table if not exists public.crm_agreement (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  crm_organization_id uuid not null references public.crm_organization (id) on delete cascade,
  contact_id uuid references public.crm_contact (id) on delete set null,
  title text not null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'ended')),
  starts_on date,
  ends_on date,
  notes text,
  created_by uuid references public.user_profile (id),
  created_at timestamptz not null default now()
);

alter table public.crm_link
  drop constraint if exists crm_link_agreement_id_fkey;
alter table public.crm_link
  add constraint crm_link_agreement_id_fkey
  foreign key (agreement_id) references public.crm_agreement (id) on delete cascade;

alter table public.crm_agreement enable row level security;
drop policy if exists crm_agreement_read on public.crm_agreement;
create policy crm_agreement_read on public.crm_agreement for select to authenticated
  using (app.can_access_crm(organization_id));
drop policy if exists crm_agreement_write on public.crm_agreement;
create policy crm_agreement_write on public.crm_agreement for all to authenticated
  using (app.can_access_crm(organization_id))
  with check (app.can_access_crm(organization_id));

comment on column public.project.funding_source_id is
  'Optional CRM organization that funds this project.';
comment on table public.crm_agreement is
  'A relationship agreement — not a full contract system.';
