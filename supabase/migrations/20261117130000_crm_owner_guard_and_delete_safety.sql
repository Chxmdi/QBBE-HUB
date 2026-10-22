-- CRM ownership and deletion.
--
-- 1. The owner of a CRM contact or organization (with administrators) is
--    the only person who reads its sensitive note, but any staff member
--    could set owner_id on any record, so anyone with CRM access could make
--    themselves owner and read the note. Now, with a member session, a new
--    record is owned by its creator (or nobody), ownership changes only
--    when the current owner hands it off or an administrator reassigns it,
--    and a record cannot be moved to another organization.
-- 2. The read policies and the sensitive-note check also let a record's
--    owner in without checking that they are still staff, so people moved to
--    volunteer or guest, or deactivated, kept reading and changing what they
--    owned. Owning a record now gives nothing beyond staff access.
-- 3. Staff could hard-delete CRM organizations, contacts and opportunities
--    through the API, and the delete cascaded to interactions, follow-ups,
--    agreements, sensitive notes, links, opportunities and approval
--    requests, unaudited. Staff now archive instead (no delete policy), and
--    those child links no longer cascade, so a delete with history attached
--    fails rather than wiping it. (NO ACTION rather than RESTRICT, so
--    deleting a whole organization tenant, which removes parents and children
--    in one statement, still works.)

-- 1. Ownership changes ------------------------------------------------------

create or replace function app.guard_crm_owner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  -- Server code (service role, jobs, imports) chooses owners itself.
  if coalesce(auth.jwt()->>'role', '') <> 'authenticated' then
    return new;
  end if;
  -- A record stays in its organization; moving it would let an
  -- administrator of another organization take it over.
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'A CRM record cannot move to another organization.'
      using errcode = '42501';
  end if;
  if app.is_org_admin(new.organization_id) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.owner_id is not null and new.owner_id is distinct from v_uid then
      raise exception 'A new CRM record is owned by the person who creates it.'
        using errcode = '42501';
    end if;
  elsif new.owner_id is distinct from old.owner_id
        and old.owner_id is distinct from v_uid then
    raise exception 'Only the current owner or an administrator can change who owns a CRM record.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app.guard_crm_owner_change() from public, anon, authenticated;

drop trigger if exists crm_contact_guard_owner_change on public.crm_contact;
create trigger crm_contact_guard_owner_change
  before insert or update of owner_id, organization_id on public.crm_contact
  for each row execute function app.guard_crm_owner_change();

drop trigger if exists crm_organization_guard_owner_change on public.crm_organization;
create trigger crm_organization_guard_owner_change
  before insert or update of owner_id, organization_id on public.crm_organization
  for each row execute function app.guard_crm_owner_change();

-- 2. Owners who are no longer staff -------------------------------------------

create or replace function app.can_read_crm_sensitive(p_owner uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_owner is not null
    and (
      (p_owner = (select auth.uid()) and app.is_org_staff(p_org))
      or app.is_org_admin(p_org)
    );
$$;

revoke all on function app.can_read_crm_sensitive(uuid, uuid) from public, anon;
grant execute on function app.can_read_crm_sensitive(uuid, uuid) to authenticated, service_role;

-- The owner branch added nothing for staff (who already have CRM access)
-- and kept former staff in, so the read policies are CRM access only.
drop policy if exists crm_organization_read on public.crm_organization;
create policy crm_organization_read on public.crm_organization
  for select to authenticated using (app.can_access_crm(organization_id));

drop policy if exists crm_contact_read on public.crm_contact;
create policy crm_contact_read on public.crm_contact
  for select to authenticated using (app.can_access_crm(organization_id));

drop policy if exists crm_interaction_read on public.crm_interaction;
create policy crm_interaction_read on public.crm_interaction
  for select to authenticated using (app.can_access_crm(organization_id));

drop policy if exists crm_follow_up_read on public.crm_follow_up;
create policy crm_follow_up_read on public.crm_follow_up
  for select to authenticated using (app.can_access_crm(organization_id));

drop policy if exists opportunity_read on public.opportunity;
create policy opportunity_read on public.opportunity
  for select to authenticated using (app.can_access_crm(organization_id));

-- Administrators: the CRM records still owned by someone who is no longer
-- active staff in the organization, so they can be reassigned.
create or replace function public.crm_records_owned_by_former_staff()
returns table (record_type text, record_id uuid, record_name text, owner_id uuid, owner_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.organization_membership m
    where m.user_id = (select auth.uid()) and m.status = 'active'
      and app.is_org_admin(m.organization_id)
  ) then
    raise exception 'Only an administrator can list CRM ownership.' using errcode = '42501';
  end if;
  return query
  with records as (
    select 'organization'::text as kind, o.id, o.name, o.owner_id, o.organization_id
    from public.crm_organization o
    union all
    select 'contact', c.id, c.full_name, c.owner_id, c.organization_id
    from public.crm_contact c
  )
  select r.kind, r.id, r.name, r.owner_id, p.full_name
  from records r
  left join public.user_profile p on p.id = r.owner_id
  where r.owner_id is not null
    and app.is_org_admin(r.organization_id)
    and not exists (
      select 1 from public.organization_membership m
      where m.organization_id = r.organization_id
        and m.user_id = r.owner_id
        and m.status = 'active'
        and m.role in ('owner', 'admin', 'staff')
    )
  order by r.kind, r.name;
end;
$$;

revoke all on function public.crm_records_owned_by_former_staff() from public, anon;
grant execute on function public.crm_records_owned_by_former_staff() to authenticated;

-- 3. No hard delete by staff, no silent cascades -------------------------------

drop policy if exists crm_organization_write on public.crm_organization;
create policy crm_organization_insert on public.crm_organization
  for insert to authenticated with check (app.can_access_crm(organization_id));
create policy crm_organization_update on public.crm_organization
  for update to authenticated
  using (app.can_access_crm(organization_id))
  with check (app.can_access_crm(organization_id));

drop policy if exists crm_contact_write on public.crm_contact;
create policy crm_contact_insert on public.crm_contact
  for insert to authenticated with check (app.can_access_crm(organization_id));
create policy crm_contact_update on public.crm_contact
  for update to authenticated
  using (app.can_access_crm(organization_id))
  with check (app.can_access_crm(organization_id));

drop policy if exists opportunity_write on public.opportunity;
create policy opportunity_insert on public.opportunity
  for insert to authenticated with check (app.can_access_crm(organization_id));
create policy opportunity_update on public.opportunity
  for update to authenticated
  using (app.can_access_crm(organization_id))
  with check (app.can_access_crm(organization_id));

alter table public.crm_interaction
  drop constraint crm_interaction_crm_organization_id_fkey,
  add constraint crm_interaction_crm_organization_id_fkey
    foreign key (crm_organization_id) references public.crm_organization (id);
alter table public.crm_follow_up
  drop constraint crm_follow_up_crm_organization_id_fkey,
  add constraint crm_follow_up_crm_organization_id_fkey
    foreign key (crm_organization_id) references public.crm_organization (id);
alter table public.crm_agreement
  drop constraint crm_agreement_crm_organization_id_fkey,
  add constraint crm_agreement_crm_organization_id_fkey
    foreign key (crm_organization_id) references public.crm_organization (id);
alter table public.crm_sensitive_note
  drop constraint crm_sensitive_note_crm_organization_id_fkey,
  add constraint crm_sensitive_note_crm_organization_id_fkey
    foreign key (crm_organization_id) references public.crm_organization (id),
  drop constraint crm_sensitive_note_crm_contact_id_fkey,
  add constraint crm_sensitive_note_crm_contact_id_fkey
    foreign key (crm_contact_id) references public.crm_contact (id);
alter table public.opportunity
  drop constraint opportunity_crm_organization_id_fkey,
  add constraint opportunity_crm_organization_id_fkey
    foreign key (crm_organization_id) references public.crm_organization (id);
alter table public.crm_link
  drop constraint crm_link_crm_organization_id_fkey,
  add constraint crm_link_crm_organization_id_fkey
    foreign key (crm_organization_id) references public.crm_organization (id),
  drop constraint crm_link_contact_id_fkey,
  add constraint crm_link_contact_id_fkey
    foreign key (contact_id) references public.crm_contact (id),
  drop constraint crm_link_opportunity_id_fkey,
  add constraint crm_link_opportunity_id_fkey
    foreign key (opportunity_id) references public.opportunity (id);
alter table public.approval_request
  drop constraint approval_request_opportunity_id_fkey,
  add constraint approval_request_opportunity_id_fkey
    foreign key (opportunity_id) references public.opportunity (id);
