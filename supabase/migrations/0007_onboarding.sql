-- First-run onboarding state (Part II §10.18). Tracks completion so users
-- land in a guided flow once rather than every session.

alter table user_profile
  add column if not exists onboarded_at timestamptz;

-- Density preference (P1-UX-07): compact vs comfortable on dense screens.
alter table user_profile
  add column if not exists display_density text not null default 'comfortable'
  check (display_density in ('comfortable', 'compact'));
