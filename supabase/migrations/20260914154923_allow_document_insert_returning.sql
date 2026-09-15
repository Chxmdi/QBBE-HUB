-- A stable helper cannot look up the just-inserted row during RETURNING.
-- Express the existing creator/owner branch directly against the candidate row.
create policy document_creator_read on public.document for select to authenticated
using (app.is_org_member(organization_id)
  and (owner_id = (select auth.uid()) or created_by = (select auth.uid())));
