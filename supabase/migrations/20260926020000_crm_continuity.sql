-- P1-CRM-02/03/06: communication notes, a next-action rule for live
-- relationships, a document pointer on an interaction, and a task pointer on
-- a follow-up so converting one cannot create a second task.

alter table public.crm_contact
  add column if not exists communication_notes text;

alter table public.crm_interaction
  add column if not exists document_id uuid references public.document (id) on delete set null;

alter table public.crm_follow_up
  add column if not exists task_id uuid references public.task (id) on delete set null;

create or replace function app.can_read_crm_sensitive(p_owner uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_owner is not null
    and (
      p_owner = (select auth.uid())
      or app.is_org_admin(p_org)
    );
$$;

revoke all on function app.can_read_crm_sensitive(uuid, uuid) from public, anon;
grant execute on function app.can_read_crm_sensitive(uuid, uuid)
  to authenticated, service_role;

create or replace function app.protect_crm_sensitive_notes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.sensitive_notes is distinct from old.sensitive_notes
     and not app.can_read_crm_sensitive(old.owner_id, new.organization_id)
  then
    raise exception 'Only the relationship owner or an administrator can change sensitive notes.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists crm_organization_sensitive on public.crm_organization;
create trigger crm_organization_sensitive
  before update on public.crm_organization
  for each row execute function app.protect_crm_sensitive_notes();

drop trigger if exists crm_contact_sensitive on public.crm_contact;
create trigger crm_contact_sensitive
  before update on public.crm_contact
  for each row execute function app.protect_crm_sensitive_notes();

create or replace function app.enforce_active_crm_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' then
    if new.owner_id is null then
      raise exception 'An active relationship needs an owner.'
        using errcode = '23514';
    end if;
    if new.next_action_at is null
       and not exists (
         select 1
         from public.crm_follow_up f
         where f.crm_organization_id = new.id
           and f.status = 'open'
       )
    then
      raise exception 'An active relationship needs a next action or an open follow-up.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_organization_active_owner on public.crm_organization;
-- Only on the columns the rule is about, so a relationship recorded before
-- this rule existed can still have its name or notes corrected without first
-- being given an owner and a date.
create trigger crm_organization_active_owner
  before insert or update of status, owner_id, next_action_at on public.crm_organization
  for each row execute function app.enforce_active_crm_owner();

create or replace function app.enforce_open_opportunity_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stage not in ('awarded', 'declined', 'withdrawn')
     and new.decision_expected_at is null
  then
    raise exception 'An open opportunity needs a next review date.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists opportunity_open_review on public.opportunity;
create trigger opportunity_open_review
  before insert or update of stage, decision_expected_at on public.opportunity
  for each row execute function app.enforce_open_opportunity_review();
