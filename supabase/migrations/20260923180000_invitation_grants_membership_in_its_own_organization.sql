-- ---------------------------------------------------------------------------
-- An accepted invitation joins the organization that issued it (#90).
--
-- `app.handle_new_user` chose the organization for a new account like this:
--
--   select id into v_org from organization limit 1;
--
-- An arbitrary row, with no `order by` and no relationship to the invitation
-- being accepted. The invitation was then matched on email alone, its
-- `intended_role` was read out of it — and the membership was written against
-- that arbitrary organization instead. The same value drove mandatory channel
-- enrolment and the audit row, so the trail recorded the wrong organization
-- too.
--
-- The role survived the journey and the organization did not, which is the
-- part that matters: an invitation issued as `admin` by one organization would
-- have made that person an administrator of a different one.
--
-- This was latent rather than live. Nothing in the application inserts an
-- `organization` row and production holds exactly one, so `limit 1` was
-- returning the only available answer. It would have become a cross-tenant
-- defect on the day a second organization existed, which every table's
-- `organization_id` and every policy's scoping says is the intended shape.
--
-- The fix: take the organization from the matched invitation. `limit 1` on
-- `organization` survives only as the bootstrap probe it was always meant to
-- be — "does a workspace exist yet" — and is now asked as that question
-- instead of being reused as an answer to a different one.
-- ---------------------------------------------------------------------------

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_role org_role := 'staff';
  v_channel record;
  v_invitation uuid;
  v_bootstrap boolean;
begin
  -- "Is there a workspace yet", asked as that and nothing else.
  v_bootstrap := not exists (select 1 from organization);

  if not v_bootstrap then
    -- The gate, before anything is written. Deliberately mirrors
    -- `public.signup_allowed`: first account bootstraps, everyone else needs an
    -- invitation. Kept as one predicate in two places rather than one place,
    -- because the client check is a usability affordance that should keep
    -- working — it just is not the one that counts.
    --
    -- The organization and the role are both read from the invitation here, so
    -- they cannot drift apart later.
    select i.id, i.organization_id, i.intended_role
      into v_invitation, v_org, v_role
    from invitation i
    where lower(i.email) = lower(trim(coalesce(new.email, '')))
      and i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at > now()
    order by i.created_at desc
    limit 1;

    if v_invitation is null then
      raise exception 'Sign-up is by invitation only.'
        using errcode = 'insufficient_privilege',
              hint = 'Ask an administrator to invite this address.';
    end if;
  end if;

  insert into user_profile (id, full_name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce(new.email, ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  if v_bootstrap then
    -- First user bootstraps the workspace and becomes Primary Owner.
    v_role := 'owner';
    insert into organization (name, slug)
    values ('Quebec Board of Black Educators', 'qbbe')
    returning id into v_org;

    insert into channel (organization_id, name, slug, type, privacy, purpose,
                         posting_policy, reply_policy, is_mandatory, owner_id, created_by)
    values
      (v_org, 'Announcements', 'announcements', 'announcements', 'public',
       'Official organization-wide announcements. Posting is restricted to leadership and admins.',
       'admins', 'threads_only', true, new.id, new.id),
      (v_org, 'General', 'general', 'organization', 'public',
       'Non-critical organization-wide conversation.', 'everyone', 'normal', true, new.id, new.id);
  else
    -- The invitation is spent on use. Its role was already read above.
    update invitation set accepted_at = now() where id = v_invitation;
  end if;

  insert into organization_membership (organization_id, user_id, role, status)
  values (v_org, new.id, v_role, 'active')
  on conflict (organization_id, user_id) do nothing;

  -- Auto-enroll into mandatory channels (P0-ANN-01), in the organization the
  -- membership was actually granted in.
  for v_channel in select id from channel where organization_id = v_org and is_mandatory
  loop
    insert into channel_member (channel_id, user_id, membership_source)
    values (v_channel.id, new.id, 'mandatory')
    on conflict do nothing;
  end loop;

  insert into audit_event (organization_id, actor_id, event_type, action, object_type, object_id)
  values (v_org, new.id, 'auth', 'user_provisioned', 'user_profile', new.id);

  return new;
end;
$$;
