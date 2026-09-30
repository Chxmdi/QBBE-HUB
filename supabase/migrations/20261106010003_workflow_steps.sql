-- Workspace OS S6 Flow, V1-12 (part 2): steps that wait on people and the
-- outside world.
--
--   workflow_execution      gains what a run waits on (an approval item or a
--                           review), so the resume job can continue it once
--                           that is decided.
--   workflow_review         new: "a person's review" step. The reviewer reads
--                           and decides their own review; admins read all of
--                           their organization's. Decided only through
--                           public.decide_workflow_review.
--   workflow_webhook_secret new: the per-workflow key outbound webhooks are
--                           signed with. Service role only.
--   app.workflow_submit_approval
--                           submits to the existing approval engine as the
--                           workflow's owner (it needs a signed-in person), so
--                           the engine's own rules (staff only, routing, no
--                           self-approval) apply unchanged. Service role only.

alter table public.workflow_execution
  add column if not exists waiting_on_kind text,
  add column if not exists waiting_on_id uuid;

alter table public.workflow_execution
  add constraint workflow_execution_waiting_on_kind_check
    check (waiting_on_kind is null or waiting_on_kind in ('approval', 'review')),
  add constraint workflow_execution_waiting_on_pair
    check ((waiting_on_kind is null) = (waiting_on_id is null));

create index if not exists idx_workflow_execution_waiting_on
  on public.workflow_execution (waiting_on_kind, waiting_on_id)
  where outcome = 'waiting';

-- ---------------------------------------------------------------------------
-- workflow_review
-- ---------------------------------------------------------------------------

create table public.workflow_review (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  execution_id uuid not null references public.workflow_execution (id) on delete cascade,
  step_id text not null check (char_length(step_id) between 1 and 64),
  reviewer_id uuid not null references public.user_profile (id) on delete cascade,
  instructions text not null check (char_length(instructions) between 1 and 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  comment text check (comment is null or char_length(comment) <= 2000),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null))
);

comment on table public.workflow_review is
  'A person''s review asked for by a workflow step. The run waits until the reviewer decides.';

create index idx_workflow_review_reviewer on public.workflow_review (reviewer_id, status, created_at desc);
create index idx_workflow_review_execution on public.workflow_review (execution_id);

alter table public.workflow_review enable row level security;

create policy workflow_review_reviewer_read on public.workflow_review
  for select to authenticated
  using (
    reviewer_id = (select auth.uid())
    and app.is_org_member(organization_id)
  );
create policy workflow_review_admin_read on public.workflow_review
  for select to authenticated
  using (app.is_org_admin(organization_id));
-- No insert, update or delete policy: the runner creates reviews, and the
-- reviewer decides through decide_workflow_review.

create or replace function public.decide_workflow_review(
  p_review uuid,
  p_decision text,
  p_comment text default null
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_review public.workflow_review;
begin
  if v_uid is null then
    raise exception 'Sign in to decide a review' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'A review is approved or rejected' using errcode = '22023';
  end if;
  if p_comment is not null and char_length(p_comment) > 2000 then
    raise exception 'The comment is too long' using errcode = '22023';
  end if;

  select * into v_review from public.workflow_review where id = p_review for update;
  if not found or v_review.reviewer_id <> v_uid
     or not app.is_org_member(v_review.organization_id) then
    raise exception 'This review is not yours to decide' using errcode = '42501';
  end if;
  if v_review.status <> 'pending' then
    raise exception 'This review has already been decided' using errcode = '22023';
  end if;

  update public.workflow_review
  set status = p_decision,
      comment = nullif(btrim(coalesce(p_comment, '')), ''),
      decided_at = now()
  where id = p_review;
end;
$$;

revoke all on function public.decide_workflow_review(uuid, text, text) from public, anon;
grant execute on function public.decide_workflow_review(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- workflow_webhook_secret
-- ---------------------------------------------------------------------------

create table public.workflow_webhook_secret (
  rule_id uuid primary key references public.workflow_rule (id) on delete cascade,
  organization_id uuid not null references public.organization (id) on delete cascade,
  secret text not null check (char_length(secret) >= 32),
  created_at timestamptz not null default now()
);

comment on table public.workflow_webhook_secret is
  'The key a workflow signs its outbound webhooks with (HMAC-SHA256). Read by the runner and shown to admins by a server action only.';

alter table public.workflow_webhook_secret enable row level security;
-- No policies: nobody reads or writes it through the API.

-- ---------------------------------------------------------------------------
-- app.workflow_submit_approval
-- ---------------------------------------------------------------------------

create or replace function app.workflow_submit_approval(
  p_user uuid,
  p_organization uuid,
  p_subject_type text,
  p_title text,
  p_description text default null
)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_role text := current_setting('request.jwt.claim.role', true);
  v_aal text := 'aal1';
  v_item uuid;
begin
  if p_user is null or p_organization is null then
    raise exception 'A workflow approval needs an owner' using errcode = '42501';
  end if;
  -- Same rule as app.can_as: the two-step level only with a live factor.
  if exists (
    select 1 from auth.mfa_factors f
    where f.user_id = p_user and f.factor_type = 'totp' and f.status = 'verified'
  ) then
    v_aal := 'aal2';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated', 'aal', v_aal)::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin
    v_item := public.submit_approval(p_organization, p_subject_type, p_title, null, null, p_description, null);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
    perform set_config('request.jwt.claim.role', coalesce(v_role, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_role, ''), true);
  return v_item;
end;
$$;

create or replace function public.workflow_submit_approval(
  p_user uuid,
  p_organization uuid,
  p_subject_type text,
  p_title text,
  p_description text default null
)
returns uuid
language sql volatile security definer
set search_path = ''
as $$
  select app.workflow_submit_approval(p_user, p_organization, p_subject_type, p_title, p_description);
$$;

revoke all on function app.workflow_submit_approval(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.workflow_submit_approval(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function app.workflow_submit_approval(uuid, uuid, text, text, text) to service_role;
grant execute on function public.workflow_submit_approval(uuid, uuid, text, text, text) to service_role;
