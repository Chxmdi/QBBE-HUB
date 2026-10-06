-- Workspace OS V1-17 (part 2): comments on a text selection, and suggested
-- edits with accept or reject (epic #199, stream S3b).
--
-- Selection comments
--   A comment pinned to a block (M11's block_id) can also name the stretch of
--   text it is about: where it starts and ends in the block's text, and the
--   words themselves, so the comment still reads sensibly after the text
--   moves. The anchor is fixed once written, like the block.
--
-- Suggestions
--   Someone who may comment proposes replacing a stretch of a block's text.
--   Anyone who can edit the object accepts (the new text is written through
--   the object's content adapter, then the suggestion is marked accepted) or
--   rejects it; the person who suggested it may withdraw it. A locked object
--   takes no new suggestions and none are accepted until it is unlocked.

-- ---------------------------------------------------------------------------
-- Selection anchors on comments
-- ---------------------------------------------------------------------------

alter table public.record_comment
  add column if not exists anchor jsonb;

alter table public.record_comment
  drop constraint if exists record_comment_anchor_shape;
alter table public.record_comment
  add constraint record_comment_anchor_shape check (
    anchor is null or (
      block_id is not null
      and jsonb_typeof(anchor) = 'object'
      and jsonb_typeof(anchor -> 'start') = 'number'
      and jsonb_typeof(anchor -> 'end') = 'number'
      and jsonb_typeof(anchor -> 'quote') = 'string'
      and (anchor ->> 'start')::numeric >= 0
      and (anchor ->> 'end')::numeric > (anchor ->> 'start')::numeric
      and length(anchor ->> 'quote') between 1 and 500
    )
  );

-- Same rules as 20261103110100, plus the anchor never moves.
create or replace function app.guard_object_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.block_id is distinct from old.block_id
                           or new.anchor is distinct from old.anchor) then
    raise exception 'The block a comment is pinned to cannot change.'
      using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and (select auth.uid()) is not null
     and not app.is_org_member(new.organization_id) then
    raise exception 'Comments are posted in your own organization.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app.guard_object_comment() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Suggestions
-- ---------------------------------------------------------------------------

create table if not exists public.object_suggestion (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  object_id uuid not null,
  object_type text not null,
  block_id text not null,
  start_offset integer not null,
  end_offset integer not null,
  original_text text not null,
  proposed_text text not null,
  author_id uuid not null references public.user_profile (id) on delete cascade
    default auth.uid(),
  status text not null default 'open',
  decided_by uuid references public.user_profile (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint object_suggestion_type_key check (object_type ~ '^[a-z][a-z0-9_]{0,62}$'),
  constraint object_suggestion_block_id check (block_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  constraint object_suggestion_range check (start_offset >= 0 and end_offset >= start_offset),
  constraint object_suggestion_original_matches check (length(original_text) = end_offset - start_offset),
  constraint object_suggestion_lengths check (
    length(original_text) <= 5000 and length(proposed_text) <= 5000
  ),
  constraint object_suggestion_changes_something check (original_text <> proposed_text),
  constraint object_suggestion_status_is_known
    check (status in ('open', 'accepted', 'rejected', 'withdrawn')),
  constraint object_suggestion_decision_recorded
    check ((status = 'open') = (decided_at is null))
);

create index if not exists idx_object_suggestion_object
  on public.object_suggestion (object_id, status, created_at);

alter table public.object_suggestion enable row level security;

drop policy if exists object_suggestion_read on public.object_suggestion;
create policy object_suggestion_read on public.object_suggestion
  for select to authenticated
  using (app.is_org_member(organization_id) and public.can(object_id, 'view'));

-- Suggesting is commenting on the text: the comment capability, an open
-- suggestion in your own name, in your organization, on an unlocked object.
drop policy if exists object_suggestion_insert on public.object_suggestion;
create policy object_suggestion_insert on public.object_suggestion
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and status = 'open'
    and decided_by is null
    and app.is_org_member(organization_id)
    and public.can(object_id, 'comment')
    and not public.is_object_locked(object_id)
  );

revoke all on public.object_suggestion from anon, authenticated;
grant select, insert on public.object_suggestion to authenticated;

-- Accept or reject (needs edit_content), or withdraw (the author). Only an
-- open suggestion can be decided, and a locked object takes no acceptance.
-- Returns the suggestion so the caller can apply an acceptance.
create or replace function public.decide_suggestion(p_suggestion uuid, p_decision text)
returns public.object_suggestion
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_row public.object_suggestion%rowtype;
begin
  if v_actor is null then
    raise exception 'Sign in to decide on a suggestion.' using errcode = '42501';
  end if;
  if p_decision not in ('accepted', 'rejected', 'withdrawn') then
    raise exception 'Unknown decision: %.', p_decision using errcode = 'check_violation';
  end if;

  select * into v_row from public.object_suggestion s where s.id = p_suggestion for update;
  if not found or not app.is_org_member(v_row.organization_id) or not app.can(v_row.object_id, 'view') then
    raise exception 'That suggestion does not exist.' using errcode = 'P0002';
  end if;
  if v_row.status <> 'open' then
    raise exception 'This suggestion was already decided.' using errcode = '42501';
  end if;
  if p_decision = 'withdrawn' then
    if v_row.author_id <> v_actor then
      raise exception 'Only the person who suggested it can withdraw it.' using errcode = '42501';
    end if;
  elsif not app.can(v_row.object_id, 'edit_content') then
    raise exception 'Only someone who can edit this can accept or reject suggestions.'
      using errcode = '42501';
  end if;
  if p_decision = 'accepted' and public.is_object_locked(v_row.object_id) then
    raise exception 'This object is locked.' using errcode = '42501';
  end if;

  update public.object_suggestion
     set status = p_decision, decided_by = v_actor, decided_at = now()
   where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.decide_suggestion(uuid, text) from public, anon;
grant execute on function public.decide_suggestion(uuid, text) to authenticated, service_role;

comment on table public.object_suggestion is
  'Workspace OS V1-17: proposed replacements of a stretch of block text, accepted or rejected by editors.';
