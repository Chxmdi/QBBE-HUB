-- Durable notification delivery retries. Failed rows are retained for audit
-- and only become eligible again after bounded exponential backoff.
alter table notification_delivery
  add column if not exists next_attempt_at timestamptz,
  add column if not exists provider_message_id text;

create index if not exists idx_notification_delivery_retry
  on notification_delivery (status, next_attempt_at)
  where status = 'failed';
