-- Production-hardening follow-ups (signup gate, storage entitlement, VMS unlink).

create or replace function public.signup_allowed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    not exists (select 1 from organization)
    or exists (
      select 1 from invitation i
      where lower(i.email) = lower(trim(p_email))
        and i.accepted_at is null
        and i.revoked_at is null
        and i.expires_at > now()
    );
$$;

grant execute on function public.signup_allowed(text) to anon, authenticated;

create or replace function public.clear_org_vms_ids()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  if not app.is_admin() then
    raise exception 'not authorized';
  end if;
  select m.organization_id into v_org
  from organization_membership m
  where m.user_id = auth.uid()
    and m.status = 'active'
  limit 1;
  if v_org is null then
    return;
  end if;
  update user_profile p
     set vms_id = null
   where p.vms_id is not null
     and exists (
       select 1 from organization_membership m
        where m.user_id = p.id
          and m.organization_id = v_org
     );
end;
$$;

grant execute on function public.clear_org_vms_ids() to authenticated;

drop policy if exists "documents read for active members" on storage.objects;

create policy "documents read for entitled members"
  on storage.objects for select
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from document d
      where d.storage_path = name
        and (
          app.is_staff()
          or (d.visibility = 'organization' and app.is_member())
        )
    )
  );
