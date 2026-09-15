-- Leadership viewers receive explicit portfolio read access at the scoped-RLS
-- cutover. Existing policies are intentionally unchanged by this migration.
-- Do not assign this role before that cutover because legacy organization-wide
-- read policies still treat every active organization member alike.
alter type public.org_role add value if not exists 'leadership_viewer' after 'admin';
