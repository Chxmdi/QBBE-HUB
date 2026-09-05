-- ---------------------------------------------------------------------------
-- A completed recurring task may spawn exactly one successor.
--
-- The next occurrence is created inline when a task is set to completed, and
-- nothing stopped that happening twice. `updateTaskStatus` never checked the
-- task's prior status, so setting an already-completed task to "completed"
-- again inserted another copy — and because the insert carried no key of any
-- kind, an ordinary client retry, a double-click, or two people closing the
-- same task did the same.
--
-- The duplicates are indistinguishable from real work. Same title, same
-- assignee, same due date, no marker saying which one was the accident. By the
-- time anybody notices there is no way to tell the copy from the original, so
-- this is a bug that quietly corrupts a task list rather than one that breaks
-- something visibly.
--
-- A guard in the command would fix the ordinary case and still lose a race:
-- two requests can both read "not completed" before either writes. So the rule
-- lives here instead, as the shape of the data — a successor points at the
-- occurrence it came from, and an occurrence can be pointed at once. A second
-- attempt does not need to be detected; it cannot be recorded.
--
-- The pointer is worth having on its own. Occurrences were unlinked copies
-- with nothing tying a series together, which is the larger gap behind this
-- one (P1-TSK-05: there is still no series entity, and this does not create
-- one). A chain of predecessors is not a series, but it is the first thing
-- that makes a series recoverable from the data.
-- ---------------------------------------------------------------------------

alter table task
  add column if not exists recurrence_parent_id uuid
  references task (id) on delete set null;

-- The guarantee. Partial, because every non-recurring task leaves this null
-- and nulls must not collide with each other.
create unique index if not exists uq_one_successor_per_recurring_task
  on task (recurrence_parent_id)
  where recurrence_parent_id is not null;

-- A task cannot be its own successor. Cheap to state, and the kind of thing a
-- future bulk-copy would otherwise be free to produce.
alter table task
  add constraint task_is_not_its_own_successor
  check (recurrence_parent_id is null or recurrence_parent_id <> id);
