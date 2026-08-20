-- Gmail watch cursors and expirations are server-only OAuth-adjacent state.
-- They remain on integration_secret, which has no authenticated SELECT policy.
alter table integration_secret
  add column if not exists gmail_history_id text,
  add column if not exists gmail_pending_history_id text,
  add column if not exists gmail_watch_expiration_at timestamptz,
  add column if not exists gmail_last_push_at timestamptz;

create index if not exists idx_integration_secret_gmail_watch_expiry
  on integration_secret (gmail_watch_expiration_at)
  where gmail_watch_expiration_at is not null;
