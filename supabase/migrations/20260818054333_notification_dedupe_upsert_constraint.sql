-- PostgreSQL treats NULL values as distinct in a normal unique constraint,
-- preserving notifications without a dedupe key while allowing PostgREST to
-- target the non-null dedupe key for atomic idempotent upserts.
drop index if exists uq_notification_dedupe;

alter table notification
  add constraint uq_notification_user_dedupe unique (user_id, dedupe_key);
