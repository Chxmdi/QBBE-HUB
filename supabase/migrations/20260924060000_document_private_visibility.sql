-- Drive mirrors need an owner-scoped state distinct from organization/staff.
-- Existing authorization already grants owner/creator/admin reads regardless
-- of visibility and only grants unattached organization-wide reads when the
-- value is exactly 'organization'. Document the third intentional state.
comment on column public.document.visibility is
  'organization = active organization members when unattached; staff = restricted operational resource; private = owner/creator plus privileged recovery roles or explicit linked-record authorization.';
