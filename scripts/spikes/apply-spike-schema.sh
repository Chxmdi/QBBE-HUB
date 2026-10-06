#!/usr/bin/env bash
# Applies the W0-6 spike table and policies to the LOCAL Supabase database.
# Refuses any database that is not on this machine.
set -euo pipefail
DB_URL="${SPIKE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
case "$DB_URL" in
  *@127.0.0.1:*|*@localhost:*) ;;
  *) echo "Refusing: $DB_URL is not a local database." >&2; exit 1 ;;
esac
SQL="$(dirname "$0")/../../src/features/editor/spike/sql/spike-schema.sql"
export PGOPTIONS="--client-min-messages=warning"
if command -v psql >/dev/null 2>&1; then
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$SQL"
else
  # The Supabase CLI names the container after project_id in supabase/config.toml.
  docker exec -i supabase_db_workspace psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$SQL"
fi
echo "Spike schema applied to the local database."
