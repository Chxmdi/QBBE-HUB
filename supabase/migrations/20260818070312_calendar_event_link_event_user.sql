-- A Hub event has at most one Calendar link for its owner. This makes create
-- retries idempotent without constraining imported overlay-only events.
create unique index if not exists uq_calendar_event_link_event_user
  on calendar_event_link (event_id, user_id) where event_id is not null;
