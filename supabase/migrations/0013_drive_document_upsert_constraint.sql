-- PostgREST's `onConflict` targets require an unconditional unique index.
-- Nullable manual documents remain distinct under PostgreSQL's NULL semantics,
-- while connected Drive resources gain reliable idempotent upserts.
drop index if exists uq_document_integration_external;

create unique index uq_document_integration_external
  on document (integration_connection_id, external_id);
