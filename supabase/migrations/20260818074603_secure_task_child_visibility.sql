-- Child records must never reveal a task that the requester cannot read.
-- Parent task RLS remains the single source of visibility authorization.
drop policy if exists task_dependency_read on task_dependency;
create policy task_dependency_read on task_dependency
  for select to authenticated
  using (
    exists (select 1 from task t where t.id = blocking_task_id)
    and exists (select 1 from task t where t.id = blocked_task_id)
  );

drop policy if exists checklist_read on checklist_item;
create policy checklist_read on checklist_item
  for select to authenticated
  using (exists (select 1 from task t where t.id = task_id));

drop policy if exists task_label_read on task_label;
create policy task_label_read on task_label
  for select to authenticated
  using (exists (select 1 from task t where t.id = task_id));

drop policy if exists task_comment_read on task_comment;
create policy task_comment_read on task_comment
  for select to authenticated
  using (exists (select 1 from task t where t.id = task_id));
