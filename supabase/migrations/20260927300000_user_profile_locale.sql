-- #141: each person picks the language the Hub speaks to them in.
--
-- Null means "no choice made yet": the app then follows the browser's
-- Accept-Language, which is what the issue asks for as the default. The set of
-- values is closed so a typo cannot store a language no catalogue exists for.
--
-- No new policy: `profile_self_update` already lets a person update only their
-- own row, which is exactly who may change this.
alter table public.user_profile
  add column if not exists locale text
  check (locale is null or locale in ('en', 'fr-CA'));

comment on column public.user_profile.locale is
  'Interface language chosen by the person (en or fr-CA). Null follows the browser.';
