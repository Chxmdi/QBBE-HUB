-- Scoped-role fixture grants for the browser role matrix (#110). Idempotent.
-- Never run in production. Runs after supabase/seed/seed.sql, because the
-- programs and projects it grants on are created there.
--
--   qa-lead         program lead on "Family First"
--   qa-pm           project manager on "Fall Community Workshop Series"
--   qa-contributor  contributor on "Tutor Recruitment Drive"
--   qa-readonly     read-only on "Fall Community Workshop Series"

insert into program_access_grant (organization_id, program_id, user_id, role, source, created_by)
select p.organization_id, p.id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6', 'lead', 'direct',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
from program p
where p.slug = 'family-first'
  and not exists (
    select 1 from program_access_grant g
    where g.program_id = p.id and g.user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6'
  );

insert into project_access_grant (organization_id, project_id, user_id, role, source, created_by)
select p.organization_id, p.id, v.user_id::uuid, v.role::project_access_role, 'direct',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
from (values
  ('Fall Community Workshop Series', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7', 'project_manager'),
  ('Tutor Recruitment Drive', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8', 'contributor'),
  ('Fall Community Workshop Series', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9', 'read_only')
) as v(project_name, user_id, role)
join project p on p.name = v.project_name
where not exists (
  select 1 from project_access_grant g
  where g.project_id = p.id and g.user_id = v.user_id::uuid and g.source = 'direct'
);
