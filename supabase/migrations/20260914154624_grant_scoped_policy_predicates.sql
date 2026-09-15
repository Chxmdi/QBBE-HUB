-- RLS policies call these helpers directly. Both derive the actor from auth.uid()
-- and enforce active membership; no arbitrary actor parameter is exposed.
grant execute on function app.has_program_capability(uuid, text),
  app.has_project_capability(uuid, text) to authenticated;
