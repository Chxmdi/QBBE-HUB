-- QBBE Hub — milestones mean what they say (#28, P0-MIL-01).
--
-- `20260912040000` gave milestone an owner, a description, a status and an
-- evidence field. No line of application code has written or read any of them
-- since, which left two problems in the data rather than in the interface:
--
--   1. **Completion had two representations that could disagree.**
--      `completeMilestone` set `completed_at` and never touched `status`, so a
--      completed milestone still reported `status = 'planned'`. Whichever a
--      future reader picked, half the product would have disagreed with it.
--      The trigger below makes them one fact with two spellings: write either
--      and the other follows.
--
--   2. **A milestone could be completed with nothing to show for it.** The
--      issue's definition of done is that completion evidence persists and is
--      visible after a refresh, which is only meaningful if completing
--      requires some. The constraint is added NOT VALID: rows completed before
--      this migration are grandfathered rather than retro-fitted with invented
--      evidence, and every insert and update from here on is checked.
--
-- Deliberately *not* enforced here: that `missed` requires a past target date.
-- The only clock this function has is the server's, and `current_date` is UTC.
-- A milestone due today in Toronto is already "yesterday" in UTC after 20:00,
-- so a database rule would let it be marked missed while it was still due —
-- the exact off-by-one this repository has shipped once before. That check
-- belongs in the command, which knows the organization's time zone.

-- Ordering. Every milestone created through the application landed on the
-- default 0, so "ordered milestones" was a column nothing ordered by and
-- nothing could set. New milestones now go to the end of their project.
-- `sort_key = 0` is the sentinel for "caller did not choose", which is why a
-- deliberate 0 is not expressible; no caller wants one.
create or replace function app.position_new_milestone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sort_key = 0 then
    select coalesce(max(m.sort_key), 0) + 1 into new.sort_key
    from public.milestone m
    where m.project_id = new.project_id;
  end if;
  return new;
end;
$$;

revoke all on function app.position_new_milestone() from public, anon, authenticated;

create trigger trg_milestone_position
  before insert on public.milestone
  for each row execute function app.position_new_milestone();

create or replace function app.sync_milestone_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'completed' and new.completed_at is null then
      new.completed_at = now();
    elsif new.completed_at is not null then
      new.status = 'completed';
    end if;
    return new;
  end if;

  -- Whichever side the caller wrote is the side that wins, so an old caller
  -- that only knows about `completed_at` still leaves the row consistent.
  if new.completed_at is distinct from old.completed_at then
    if new.completed_at is not null then
      new.status = 'completed';
    elsif new.status = 'completed' then
      -- Reopening returns it to open work. 'planned' rather than 'in_progress'
      -- because nothing here knows whether anybody has restarted it.
      new.status = 'planned';
    end if;
  elsif new.status is distinct from old.status then
    if new.status = 'completed' then
      new.completed_at = coalesce(new.completed_at, now());
    elsif old.status = 'completed' then
      new.completed_at = null;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function app.sync_milestone_status() from public, anon, authenticated;

create trigger trg_milestone_status
  before insert or update on public.milestone
  for each row execute function app.sync_milestone_status();

alter table public.milestone
  add constraint completed_milestones_show_their_work
  check (
    status <> 'completed'
    or (evidence is not null and length(btrim(evidence)) > 0)
  )
  not valid;

comment on column public.milestone.evidence is
  'What shows the milestone was met. Required to complete one.';
comment on column public.milestone.status is
  'planned | in_progress | completed | missed. Kept in step with completed_at by trigger.';
