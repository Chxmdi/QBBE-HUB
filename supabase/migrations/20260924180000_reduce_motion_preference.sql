-- UI-009 / P0-UX-04: reduced motion as a user setting, not only an OS one.
-- Someone on a shared or managed machine may be unable to change the
-- operating-system preference; this lets them reduce motion in the Hub.
-- Written through the existing profile_self_update policy (own row only).
alter table user_profile
  add column if not exists reduce_motion boolean not null default false;

comment on column user_profile.reduce_motion is
  'User asked the Hub to minimise animation, independent of the OS setting.';
