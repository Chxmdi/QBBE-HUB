-- ---------------------------------------------------------------------------
-- Enforce invite-only sign-up where the membership is actually granted.
--
-- `public.signup_allowed(email)` has always held the right rule: permit the
-- very first account, which bootstraps the workspace, and otherwise require a
-- live, unaccepted, unexpired invitation for that address. The problem was
-- never the predicate. It was the only caller.
--
-- `signup_allowed` was called from `sign-up-form.tsx`, a "use client"
-- component. That is a courtesy check in someone else's browser, not an
-- authorization boundary. Meanwhile the trigger below — which is what actually
-- creates the membership row, and therefore the real decision point — never
-- consulted it. When no invitation matched it fell through to `'staff'` and
-- inserted an ACTIVE membership.
--
-- So a POST to /auth/v1/signup with the publishable anon key produced an
-- active staff account: every project and programme, the CRM, reports, every
-- task, every public channel. No invitation, no approval, no trace beyond a
-- provisioning audit row that looks exactly like a legitimate one. The anon
-- key is published in `.env.production` in a public repository, which is
-- correct — it is designed to be public — and is precisely why the browser
-- cannot be where this is decided.
--
-- Two details made it hard to see. The deployment runbook assured the operator
-- that "the app also enforces invite-only via signup_allowed", which was true
-- of the form and false of the system. And `rls.sql` asserted that
-- `signup_allowed` returns false for a stranger — a passing test, sitting
-- directly over the gap, proving the predicate worked while nothing checked
-- that anyone asked it.
--
-- The rule now lives in the trigger. An uninvited sign-up raises, which aborts
-- the `auth.users` insert, so no orphaned account is left behind: the account
-- is refused rather than created-then-ignored. Refusing costs a stranger an
-- error message; admitting them costs the organization its data.
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
begin
  select id into v_org from organization limit 1;

  -- The gate, before anything is written. Deliberately mirrors
  -- `public.signup_allowed`: first account bootstraps, everyone else needs an
  -- invitation. Kept as one predicate in two places rather than one place,
  -- because the client check is a usability affordance that should keep
  -- working — it just is not the one that counts.
  if v_org is not null then
    select i.id into v_invitation
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

  if v_org is null then
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
    -- Invited: the invitation carries the role, and is spent on use.
    select intended_role into v_role from invitation where id = v_invitation;
    update invitation set accepted_at = now() where id = v_invitation;
  end if;

  insert into organization_membership (organization_id, user_id, role, status)
  values (v_org, new.id, v_role, 'active')
  on conflict (organization_id, user_id) do nothing;

  -- Auto-enroll into mandatory channels (P0-ANN-01).
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

-- ---------------------------------------------------------------------------
-- The storage policies the organization-scoping pass missed.
--
-- Both scoping migrations rewrote policies in `public`, and the standing
-- assertion that guards against regressions filters `pg_policies` on
-- `schemaname = 'public'`. `storage.objects` is neither, so three policies
-- kept the unscoped role tests and the check could not see them — a blind spot
-- shaped exactly like the gap it was written to prevent.
--
-- `documents delete for staff` was `app.is_staff()` with no join to the
-- `document` row, so a staff member of any organization could delete any
-- object in the bucket given its path. The exports bucket, which has no
-- policies at all and is reached only through a short-lived signed URL, is the
-- pattern this one should have followed.
-- ---------------------------------------------------------------------------

-- The live name is "documents read for entitled members", set by
-- 0009_production_hardening. `0006_documents.sql` created a differently-named
-- policy that 0009 replaced, and reading 0006 rather than the catalogue is how
-- the first draft of this migration came to drop a name that no longer exists
-- — which would have added a second SELECT policy while leaving the unscoped
-- one in place. Permissive policies OR together, so that changes nothing at
-- all. CI caught it. The catalogue is the authority on what is deployed; a
-- migration file is only the authority on what someone once intended.
drop policy if exists "documents read for active members" on storage.objects;
drop policy if exists "documents read for entitled members" on storage.objects;
create policy "documents read for entitled members" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from document d
      where d.storage_path = storage.objects.name
        and (
          app.is_org_staff(d.organization_id)
          or (d.visibility = 'organization' and app.is_org_member(d.organization_id))
        )
    )
  );

drop policy if exists "documents delete for staff" on storage.objects;
create policy "documents delete for staff" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from document d
      where d.storage_path = storage.objects.name
        and app.is_org_staff(d.organization_id)
    )
  );

-- The upload policy is deliberately left as an unscoped active-member check,
-- and this is the honest reason: at upload time there is nothing to scope to.
-- The file is written first and its `document` row is inserted afterwards with
-- the returned path, so during the insert no row exists to carry an
-- organization. Scoping it would need the object key to encode the
-- organization — a path convention plus a `starts_with` check — which is a
-- real change to how documents are stored rather than a policy rewrite, and
-- not one to make quietly inside a security fix.
--
-- The exposure is bounded and worth stating plainly: an active member of any
-- organization can add an object to this bucket. They cannot read it back,
-- cannot delete it, and cannot attach it to a document they do not own, so it
-- is storage consumption rather than data access. It is named in the standing
-- assertion's exemption list so the omission is a recorded decision rather
-- than a silent hole.
