-- Workspace OS V1-8: formula properties (epic #199).
--
-- Owners and admins may now add a formula property: its formula text lives in
-- options.expression (at most 2000 characters) and it is calculated on the
-- server each time the object is read (src/features/objects/formula). The
-- application checks the formula before saving it; nothing is stored in
-- property_value for a formula, so no value can drift from its inputs.
--
-- Rollups (V1-7) and relation properties stay closed to hand-made rows here.

drop policy if exists property_definition_admin_insert on public.property_definition;
create policy property_definition_admin_insert on public.property_definition for insert to authenticated
  with check (
    system_column is null
    and kind not in ('created_by', 'created_time', 'edited_by', 'edited_time', 'relation', 'rollup')
    and (
      kind <> 'formula'
      or (jsonb_typeof(options -> 'expression') = 'string'
          and length(options ->> 'expression') between 1 and 2000)
    )
    and app.is_org_admin(organization_id)
  );

drop policy if exists property_definition_admin_update on public.property_definition;
create policy property_definition_admin_update on public.property_definition for update to authenticated
  using (system_column is null and app.is_org_admin(organization_id))
  with check (
    system_column is null
    and (
      kind <> 'formula'
      or (jsonb_typeof(options -> 'expression') = 'string'
          and length(options ->> 'expression') between 1 and 2000)
    )
    and app.is_org_admin(organization_id)
  );
