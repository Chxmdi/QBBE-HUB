-- `FOR ALL` includes SELECT, so the former broad member-write policies
-- accidentally bypassed the parent-visibility policies. Keep mutations tied
-- to a task the caller can read, while leaving SELECT to the policies above.
drop policy if exists checklist_member_write on checklist_item;
create policy checklist_insert on checklist_item
  for insert to authenticated
  with check (exists (select 1 from task t where t.id = task_id));
create policy checklist_update on checklist_item
  for update to authenticated
  using (exists (select 1 from task t where t.id = task_id))
  with check (exists (select 1 from task t where t.id = task_id));
create policy checklist_delete on checklist_item
  for delete to authenticated
  using (exists (select 1 from task t where t.id = task_id));

drop policy if exists task_label_member_write on task_label;
create policy task_label_insert on task_label
  for insert to authenticated
  with check (exists (select 1 from task t where t.id = task_id));
create policy task_label_delete on task_label
  for delete to authenticated
  using (exists (select 1 from task t where t.id = task_id));
