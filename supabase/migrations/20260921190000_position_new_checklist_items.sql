-- QBBE Hub — a new checklist item goes to the end of its list (#31, P1-TSK-10).
--
-- `checklist_item.sort_key` has existed since `0001_core.sql` and the task
-- drawer has always read `.order("sort_key")`, but nothing ever wrote one.
-- Every item in the product therefore carries the default 0, and ordering a
-- column whose values are all equal is not an ordering at all: the rows come
-- back in whatever order the plan produced them.
--
-- That was invisible while nothing could be reordered. It stops being
-- invisible the moment `reorderChecklist` writes real positions, because an
-- arranged list would then be silently re-joined by newly added items, all of
-- which would sort to position 0 — the front — no matter when they were
-- added. Somebody arranges five items, adds a sixth, and the sixth jumps to
-- the top.
--
-- The rule is the one `position_new_milestone` already uses for milestones, in
-- the same words and for the same reason: 0 is the sentinel for "the caller
-- did not choose", which is why a deliberate 0 is not expressible. No caller
-- wants one.
create or replace function app.position_new_checklist_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sort_key = 0 then
    select coalesce(max(c.sort_key), 0) + 1 into new.sort_key
    from public.checklist_item c
    where c.task_id = new.task_id;
  end if;
  return new;
end;
$$;
revoke all on function app.position_new_checklist_item() from public, anon, authenticated;

drop trigger if exists checklist_item_position on public.checklist_item;
create trigger checklist_item_position
  before insert on public.checklist_item
  for each row execute function app.position_new_checklist_item();

-- Existing rows all sit on 0, so they are ordered by nothing. Give them a
-- stable order once, by creation time, which is the order they were actually
-- added in and the only defensible answer available after the fact.
with ranked as (
  select id, row_number() over (partition by task_id order by created_at, id) as position
  from public.checklist_item
  where sort_key = 0
)
update public.checklist_item c
set sort_key = ranked.position
from ranked
where c.id = ranked.id;
