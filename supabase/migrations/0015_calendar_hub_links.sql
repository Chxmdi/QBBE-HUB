-- Links imported/created Google events to the Hub source record for
-- reconciliation without overloading generic external IDs.
alter table calendar_event_link
  add column if not exists meeting_id uuid references meeting (id) on delete cascade,
  add column if not exists event_id uuid references event (id) on delete cascade,
  add column if not exists external_updated_at timestamptz;

create unique index if not exists uq_calendar_event_link_meeting_user
  on calendar_event_link (meeting_id, user_id) where meeting_id is not null;
