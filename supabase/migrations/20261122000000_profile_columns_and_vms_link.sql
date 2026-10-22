-- Profiles and volunteer-system identities.
--
-- The profile update policy let a person change any column of their own
-- profile, so they could set their email to any address or claim another
-- volunteer's volunteer-system identity (and receive that person's
-- assignments on the next sync). The administrators' linking action
-- updated someone else's profile with their own session, which the policy
-- refused, so linking never worked. Unlinking and disconnecting the
-- volunteer system tried to delete the copied assignment records with a
-- session that has no delete right, so the records stayed. Administrators
-- also had no way to correct a member's name.
--
-- Now a person updates only their own name, title, photo, time zone and
-- display choices. Administrators with MFA link or unlink an identity and
-- correct a member's name and title through audited functions, and
-- unlinking or disconnecting removes the copied assignments.

revoke update on public.user_profile from anon, authenticated;
grant update (full_name, avatar_url, title, timezone, display_density, reduce_motion, locale, onboarded_at)
  on public.user_profile to authenticated;

drop policy if exists profile_self_update on public.user_profile;
create policy profile_self_update on public.user_profile
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Name, title and photo stay sensible whoever writes them (existing rows are
-- not rechecked).
alter table public.user_profile
  add constraint user_profile_full_name_shape
    check (char_length(btrim(full_name)) between 1 and 120) not valid,
  add constraint user_profile_title_length
    check (title is null or char_length(title) <= 120) not valid,
  add constraint user_profile_avatar_url_shape
    check (avatar_url is null or avatar_url ~ '^(https://|/)') not valid;

-- An administrator may change a person's shared profile (name, title, the
-- one volunteer-system identity) only from an organization they administer
-- with MFA, and only when they administer every organization the person
-- belongs to: the profile is the same in all of them.
create or replace function app.assert_admin_of_member(p_org uuid, p_user uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_org is null or not app.is_org_admin(p_org) or not exists (
    select 1 from public.organization_membership m
    where m.organization_id = p_org and m.user_id = p_user and m.status = 'active'
  ) then
    raise exception 'Only an administrator of this person''s organization can do this.'
      using errcode = '42501';
  end if;
  if exists (
    select 1 from public.organization_membership m
    where m.user_id = p_user and m.status = 'active'
      and m.organization_id <> p_org
      and not app.is_org_admin(m.organization_id)
  ) then
    raise exception 'This person also belongs to an organization you do not administer.'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function app.assert_admin_of_member(uuid, uuid) from public, anon, authenticated;

create or replace function public.rectify_member_profile(p_org uuid, p_user uuid, p_full_name text, p_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.user_profile;
  v_name text := btrim(coalesce(p_full_name, ''));
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
begin
  perform app.assert_admin_of_member(p_org, p_user);
  if v_name = '' or char_length(v_name) > 120 or char_length(coalesce(v_title, '')) > 120 then
    raise exception 'A name is required and a name or title is at most 120 characters.'
      using errcode = '22023';
  end if;
  select * into v_before from public.user_profile where id = p_user for update;
  update public.user_profile set full_name = v_name, title = v_title where id = p_user;
  insert into public.audit_event (organization_id, actor_id, event_type, action, object_type, object_id, metadata)
  select m.organization_id, (select auth.uid()), 'access', 'profile_rectified', 'user_profile', p_user,
         jsonb_build_object('before', jsonb_build_object('full_name', v_before.full_name, 'title', v_before.title),
                            'after', jsonb_build_object('full_name', v_name, 'title', v_title),
                            'from_organization', p_org)
  from public.organization_membership m
  where m.user_id = p_user and m.status = 'active';
end;
$$;

revoke all on function public.rectify_member_profile(uuid, uuid, text, text) from public, anon;
grant execute on function public.rectify_member_profile(uuid, uuid, text, text) to authenticated;

create or replace function public.link_vms_identity(p_org uuid, p_user uuid, p_vms_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vms text := nullif(btrim(coalesce(p_vms_id, '')), '');
begin
  perform app.assert_admin_of_member(p_org, p_user);
  if char_length(coalesce(v_vms, '')) > 200 then
    raise exception 'A volunteer-system id is at most 200 characters.' using errcode = '22023';
  end if;
  -- The id is one column shared by every organization, so it must be unique
  -- everywhere; the row lock serializes concurrent links of one person.
  perform 1 from public.user_profile where id = p_user for update;
  if v_vms is not null and exists (
    select 1 from public.user_profile p where p.vms_id = v_vms and p.id <> p_user
  ) then
    raise exception 'This volunteer-system identity is already linked to someone else.'
      using errcode = '23505';
  end if;
  -- A changed or removed link takes the old link's copied assignments with it.
  if v_vms is distinct from (select p.vms_id from public.user_profile p where p.id = p_user) then
    delete from public.vms_assignment_reference where user_id = p_user;
  end if;
  update public.user_profile
  set vms_id = v_vms, vms_availability = 'unknown', vms_synced_at = null
  where id = p_user;
  insert into public.audit_event (organization_id, actor_id, event_type, action, object_type, object_id, metadata)
  values (p_org, (select auth.uid()), 'integration',
          case when v_vms is null then 'vms_identity_unlinked' else 'vms_identity_linked' end,
          'user_profile', p_user,
          case when v_vms is null then '{}'::jsonb else jsonb_build_object('vms_id', v_vms) end);
end;
$$;

revoke all on function public.link_vms_identity(uuid, uuid, text) from public, anon;
grant execute on function public.link_vms_identity(uuid, uuid, text) to authenticated;

-- Disconnecting the volunteer system in an organization: its copied
-- assignments and its members' links go.
drop function if exists public.clear_org_vms_ids();
create or replace function public.clear_org_vms_ids(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org is null or not app.is_org_admin(p_org) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.vms_assignment_reference where organization_id = p_org;
  update public.user_profile p
     set vms_id = null, vms_availability = 'unknown', vms_synced_at = null
   where p.vms_id is not null
     and exists (
       select 1 from public.organization_membership m
        where m.user_id = p.id
          and m.organization_id = p_org
     );
end;
$$;

revoke all on function public.clear_org_vms_ids(uuid) from public, anon;
grant execute on function public.clear_org_vms_ids(uuid) to authenticated;
