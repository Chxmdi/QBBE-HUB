-- When each person acknowledged which version of the privacy notice.
--
-- Quebec's Law 25 asks that people be told, when their information is
-- collected, what is collected and why. The notice is at /privacy
-- (src/config/privacy.ts holds its version). Finishing onboarding records an
-- acknowledgement of the current version, so the organization can show who
-- was shown which text.
--
-- Each person writes and reads only their own rows. The time comes from the
-- database (no insert privilege on the column), and nothing in the API can
-- change or remove a row: an acknowledgement that can be edited proves
-- nothing. Rows go when the person's profile is deleted.
-- supabase/tests/privacy-notice-acknowledgement.sql checks all of this.

create table public.privacy_notice_acknowledgement (
  user_id uuid not null references public.user_profile (id) on delete cascade,
  notice_version text not null
    check (notice_version ~ '^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])(-draft)?$'),
  acknowledged_at timestamptz not null default now(),
  primary key (user_id, notice_version)
);

alter table public.privacy_notice_acknowledgement enable row level security;

revoke all on table public.privacy_notice_acknowledgement from public, anon, authenticated, service_role;
grant select on table public.privacy_notice_acknowledgement to authenticated;
grant insert (user_id, notice_version) on table public.privacy_notice_acknowledgement to authenticated;
-- Read and record only, as for everyone: no role needs to change a row.
grant select, insert on table public.privacy_notice_acknowledgement to service_role;

create policy privacy_notice_acknowledgement_read_own
  on public.privacy_notice_acknowledgement
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy privacy_notice_acknowledgement_insert_own
  on public.privacy_notice_acknowledgement
  for insert to authenticated
  with check (user_id = (select auth.uid()));

comment on table public.privacy_notice_acknowledgement is
  'Which version of the privacy notice (/privacy) each person acknowledged, and when. Own rows only; append-only through the API.';
