-- Let a returned request actually be clarified, and stop an author moving their
-- own request to a status only a reviewer may set (#27, P1-PRJ-07).
--
-- project_request_edit_own allowed an update only while status = 'submitted'.
-- The enum has carried 'deferred' and 'returned' since 20260912040000, but a
-- returned request was frozen: the reviewer could ask for more information and
-- the author had no way to supply it. "Returned for clarification" was a label
-- on a dead end.
--
-- The old WITH CHECK tested only ownership, so the author could also set the
-- status themselves. The CHECK constraints blocked the damaging cases —
-- 'approved' needs a project_id, a refusal needs a decision note — but nothing
-- stopped an author moving their own request to 'in_review' or 'deferred' and
-- misrepresenting where it stood. The new check names the three statuses an
-- author may leave their request in: still submitted, resubmitted after a
-- return, or withdrawn.

drop policy if exists project_request_edit_own on public.project_request;

create policy project_request_edit_own on public.project_request for update to authenticated
  using (
    requested_by = auth.uid()
    and status in ('submitted', 'returned')
  )
  with check (
    requested_by = auth.uid()
    and status in ('submitted', 'returned', 'withdrawn')
  );

-- ---------------------------------------------------------------------------
-- Who runs the queue (#27, P1-PRJ-07)
-- ---------------------------------------------------------------------------
--
-- `project_request_staff` was one `for all` policy predicated on
-- app.is_org_staff. It is the last intake surface still using the broad staff
-- predicate that every sibling surface moved off in the scoped access cutover
-- (20260910030005, 20260912021000). Under it, any staff member could approve a
-- request into a program they hold nothing on — and approval creates a real
-- project inside that program.
--
-- Reading and writing are separated deliberately:
--
--   read  — stays with all staff. Triage is how a request reaches the right
--           person, and a request that silently disappears from the queue is
--           worse than one that refuses a decision with a reason.
--   write — requires `manage` on the program the request names. A request
--           naming no program keeps the staff rule, because there is no
--           narrower scope to apply and somebody has to be able to answer it.
--
-- One consequence worth stating: has_program_capability requires AAL2 before
-- it grants an owner or administrator anything beyond `read`, so deciding a
-- program-scoped request needs a second factor. That is the same bar
-- createProject already sets for creating a project in that program, which is
-- exactly what approving the request does.

drop policy if exists project_request_staff on public.project_request;

create policy project_request_queue_read on public.project_request
  for select to authenticated
  using (app.is_org_staff(organization_id));

create policy project_request_queue_write on public.project_request
  for update to authenticated
  using (
    app.is_org_staff(organization_id)
    and (program_id is null or app.has_program_capability(program_id, 'manage'))
  )
  with check (
    app.is_org_staff(organization_id)
    and (program_id is null or app.has_program_capability(program_id, 'manage'))
  );

create policy project_request_queue_delete on public.project_request
  for delete to authenticated
  using (
    app.is_org_staff(organization_id)
    and (program_id is null or app.has_program_capability(program_id, 'manage'))
  );
