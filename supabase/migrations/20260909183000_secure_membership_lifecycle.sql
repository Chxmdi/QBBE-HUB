-- Keep membership lifecycle invariants below the browser/server-action layer.
-- Direct Data API updates may manage ordinary members, but ownership can only
-- move through the locked, AAL2 transfer command below.

create unique index organization_membership_one_active_owner_idx
  on public.organization_membership (organization_id)
  where role = 'owner' and status = 'active';

create or replace function public.guard_organization_membership_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.user_id is distinct from old.user_id then
    raise exception 'Membership identity cannot be changed.' using errcode = '22023';
  end if;

  -- Statements issued by a SECURITY DEFINER maintenance command or by the
  -- service role may perform owner changes. Ordinary authenticated statements
  -- must use transfer_organization_ownership instead.
  if current_user not in ('postgres', 'service_role') then
    if old.role = 'owner'
       and (new.role is distinct from old.role or new.status is distinct from old.status) then
      raise exception 'The Primary Owner can only change through ownership transfer.'
        using errcode = '42501';
    end if;

    if new.role = 'owner' and old.role is distinct from new.role then
      raise exception 'The Primary Owner can only change through ownership transfer.'
        using errcode = '42501';
    end if;

    if old.user_id = auth.uid()
       and new.status is distinct from old.status then
      raise exception 'You cannot change your own account status.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_organization_membership_update
  on public.organization_membership;
create trigger guard_organization_membership_update
before update on public.organization_membership
for each row execute function public.guard_organization_membership_update();

create or replace function public.audit_organization_membership_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.role is distinct from old.role then
    insert into public.audit_event (
      organization_id, actor_id, event_type, action, object_type, object_id, metadata
    ) values (
      new.organization_id,
      auth.uid(),
      'access',
      'role_changed',
      'organization_membership',
      new.id,
      jsonb_build_object('from', old.role, 'to', new.role)
    );
  end if;

  if new.status is distinct from old.status then
    insert into public.audit_event (
      organization_id, actor_id, event_type, action, object_type, object_id, metadata
    ) values (
      new.organization_id,
      auth.uid(),
      'access',
      case
        when new.status = 'deactivated' then 'user_deactivated'
        when old.status = 'deactivated' and new.status = 'active' then 'user_reactivated'
        else 'membership_status_changed'
      end,
      'organization_membership',
      new.id,
      jsonb_build_object('from', old.status, 'to', new.status)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists audit_organization_membership_update
  on public.organization_membership;
create trigger audit_organization_membership_update
after update on public.organization_membership
for each row
when (old.role is distinct from new.role or old.status is distinct from new.status)
execute function public.audit_organization_membership_update();

create or replace function public.transfer_organization_ownership(
  p_target_membership uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_organization uuid;
  v_current_membership uuid;
  v_target_user uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2' then
    raise exception 'A second authentication factor is required.' using errcode = '42501';
  end if;

  select organization_id, user_id
    into v_organization, v_target_user
  from public.organization_membership
  where id = p_target_membership
    and status = 'active';

  if v_organization is null then
    raise exception 'The target must be an active member of an organization you own.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.organization_membership
    where organization_id = v_organization
      and user_id = v_actor
      and role = 'owner'
      and status = 'active'
  ) then
    raise exception 'The target must be an active member of an organization you own.'
      using errcode = '22023';
  end if;

  -- Lock the complete membership set in one stable order. Concurrent transfers
  -- for the same organization serialize and re-check authority after waiting.
  perform 1
  from public.organization_membership
  where organization_id = v_organization
  order by id
  for update;

  select id
    into v_current_membership
  from public.organization_membership
  where organization_id = v_organization
    and user_id = v_actor
    and role = 'owner'
    and status = 'active';

  if v_current_membership is null then
    raise exception 'Ownership changed before this transfer completed. Retry.'
      using errcode = '40001';
  end if;

  if v_target_user = v_actor then
    raise exception 'You already hold Primary Owner.' using errcode = '22023';
  end if;

  update public.organization_membership
  set role = 'admin'
  where id = v_current_membership;

  update public.organization_membership
  set role = 'owner'
  where id = p_target_membership;

  insert into public.audit_event (
    organization_id, actor_id, event_type, action, object_type, object_id, metadata
  ) values (
    v_organization,
    v_actor,
    'access',
    'ownership_transferred',
    'organization_membership',
    p_target_membership,
    jsonb_build_object(
      'from_user_id', v_actor,
      'to_user_id', v_target_user,
      'from_membership_id', v_current_membership,
      'to_membership_id', p_target_membership
    )
  );
end;
$$;

revoke all on function public.guard_organization_membership_update() from public, anon, authenticated;
revoke all on function public.audit_organization_membership_update() from public, anon, authenticated;
revoke all on function public.transfer_organization_ownership(uuid) from public, anon;
grant execute on function public.transfer_organization_ownership(uuid) to authenticated;
