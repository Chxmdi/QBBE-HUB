-- A Calendar sync token belongs to the server-only OAuth state. It lets the
-- scheduled worker request only changes since the prior completed sync.
alter table integration_secret
  add column if not exists google_calendar_sync_token text;
