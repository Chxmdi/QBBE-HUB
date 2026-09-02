-- ---------------------------------------------------------------------------
-- The three unscoped policies the previous migration missed.
--
-- They were not found by reading the repository, because each embeds a
-- multi-line subquery that defeated the pattern used to survey the migrations.
-- They were found by asking the live database directly — `pg_policies` returns
-- the expression as Postgres actually holds it, already normalised, with no
-- parsing on my side to get wrong.
--
-- That is the more reliable direction of travel for a question like "which
-- policies are still unscoped", and worth remembering: the repository says
-- what was intended, the catalogue says what is true.
--
-- Joining a channel and being added to a conversation both carry an
-- organization through their parent, so neither needed a schema change.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The helper functions, which are the part a policy survey cannot see.
--
-- Tightening `channel_read` did not reach `message_read`, because that policy
-- delegates to `app.can_read_channel()` — and the helper carried its own copy
-- of the unscoped test. Being SECURITY DEFINER, it does not inherit the
-- tightened policy on `channel`: it reads the table with the owner's rights
-- and answers on its own authority.
--
-- So there were two surfaces, not one, and the second is the more dangerous:
-- a definer function is where an authorization rule stops being checked again
-- downstream. Found by the allow/deny suite, which failed on
-- "admin cannot read another organization message" after the policies were
-- already scoped — the assertion knew something the survey did not.
-- ---------------------------------------------------------------------------

create or replace function app.can_read_channel(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from channel c
    where c.id = p_channel
      and (
        (c.privacy = 'public' and app.is_org_member(c.organization_id))
        or app.is_channel_member(p_channel)
      )
  );
$$;

create or replace function app.can_post_in_channel(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from channel c
    where c.id = p_channel
      and c.archived_at is null
      and app.is_channel_member(p_channel)
      and case c.posting_policy
        when 'everyone' then app.is_org_member(c.organization_id)
        when 'staff' then app.is_org_staff(c.organization_id)
        when 'admins' then app.is_org_admin(c.organization_id)
      end
  );
$$;

drop policy if exists channel_member_join on channel_member;
create policy channel_member_join on channel_member
  for insert to authenticated
  with check (
    -- Joining a public channel in your own organization.
    (
      user_id = (select auth.uid())
      and exists (
        select 1 from channel c
        where c.id = channel_id
          and c.privacy = 'public'
          and app.is_org_member(c.organization_id)
      )
    )
    -- An admin of the channel's organization adding someone.
    or exists (
      select 1 from channel c
      where c.id = channel_id and app.is_org_admin(c.organization_id)
    )
    -- The channel's owner adding someone.
    or exists (
      select 1 from channel c
      where c.id = channel_id and c.owner_id = (select auth.uid())
    )
  );

-- Mandatory channels still cannot be left by ordinary members; the only change
-- is that the admin escape hatch now has to be an admin of this channel's
-- organization rather than of any organization at all.
drop policy if exists channel_member_leave on channel_member;
create policy channel_member_leave on channel_member
  for delete to authenticated
  using (
    (
      user_id = (select auth.uid())
      and not exists (
        select 1 from channel c where c.id = channel_id and c.is_mandatory
      )
    )
    or exists (
      select 1 from channel c
      where c.id = channel_id and app.is_org_admin(c.organization_id)
    )
  );

drop policy if exists conversation_member_insert on conversation_member;
create policy conversation_member_insert on conversation_member
  for insert to authenticated
  with check (
    exists (
      select 1 from conversation c
      where c.id = conversation_id
        and app.is_org_member(c.organization_id)
    )
    and (
      user_id = (select auth.uid())
      or app.is_conversation_member(conversation_id)
      or exists (
        select 1 from conversation c
        where c.id = conversation_id and c.created_by = (select auth.uid())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- `job_run` and `job_definition` are deliberately left alone. Both are
-- platform-level tables with no organization_id: a job definition is the
-- schedule itself, not one organization's copy of it. Scoping them would mean
-- a schema change and a decision about whether the job runtime is per-tenant
-- at all, which is a design question rather than a policy fix. Recorded here
-- so the next person to run this survey knows the omission was a choice.
--
-- Their exposure is bounded: the rows carry no organization data, only job
-- names, timings and counts. `background_job_run`, which does carry
-- per-organization results, is already scoped.
-- ---------------------------------------------------------------------------
