#!/usr/bin/env bash
# Local rehearsal only: makes an empty scratch database, inside the local
# Supabase stack's Postgres, that looks like a brand-new Supabase project,
# so scripts/backup/restore-drill.sh has somewhere safe to restore into
# without a second project (docs/runbooks/backup-recovery.md).
#
#   scripts/backup/local-scratch-db.sh create [name]   # default restore_drill
#   scripts/backup/local-scratch-db.sh drop [name]
#
# A new Supabase project starts with the platform's own schemas (auth,
# storage, realtime, …), its standard extensions and the supabase_realtime
# publication, and nothing of the app. `createdb` alone gives none of that,
# so this copies the platform's schemas from the local stack's database,
# structure only, leaving out what the app added to them (its storage
# policies and its triggers on auth and storage tables): putting those back
# is the restore's job, and the drill checks it did.
#
# Refuses anything but the local stack (127.0.0.1:54322), and refuses to
# drop a database it is not named for. Uses the stack's superuser
# (supabase_admin, local password "postgres"), as the platform does for a
# new project.

set -euo pipefail
cd "$(dirname "$0")/../.."

fail() { echo "FAIL: $*" >&2; exit 1; }

action="${1:-}"
name="${2:-restore_drill}"
[[ "$action" =~ ^(create|drop)$ ]] || fail "Usage: scripts/backup/local-scratch-db.sh <create|drop> [name]"
[[ "$name" =~ ^[a-z_][a-z0-9_]*$ && "$name" != postgres && "$name" != _supabase && ! "$name" =~ ^template ]] \
  || fail "Refusing database name ${name}."

host=127.0.0.1
port="${LOCAL_DB_PORT:-54322}"
export PGPASSWORD="${LOCAL_DB_PASSWORD:-postgres}"
admin=(psql -X -q -t -A -v ON_ERROR_STOP=1 -h "$host" -p "$port" -U supabase_admin)
project_id=$(sed -n 's/^project_id = "\(.*\)"$/\1/p' supabase/config.toml)
container="supabase_db_${project_id}"
docker inspect "$container" > /dev/null 2>&1 || fail "The local stack's database container (${container}) is not running."

if [[ "$action" == drop ]]; then
  "${admin[@]}" -d postgres -c "drop database if exists ${name} with (force)"
  echo "Dropped ${name}."
  exit 0
fi

exists=$("${admin[@]}" -d postgres -c "select count(*) from pg_database where datname = '${name}'")
[[ "$exists" == 0 ]] || fail "${name} already exists. Drop it first: scripts/backup/local-scratch-db.sh drop ${name}"

"${admin[@]}" -d postgres -c "create database ${name} owner postgres"

# What a new project has before anything of the app: the extensions schema
# and the standard extensions, Vault, GraphQL, and the Realtime publication.
"${admin[@]}" -d "$name" <<'SQL'
create schema if not exists extensions authorization postgres;
grant usage on schema extensions to anon, authenticated, service_role;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_stat_statements with schema extensions;
create schema if not exists vault;
create extension if not exists supabase_vault with schema vault;
create schema if not exists graphql;
create extension if not exists pg_graphql with schema graphql;
create publication supabase_realtime;
alter publication supabase_realtime owner to postgres;
SQL

# The platform's schemas, structure only, from the stack's own database,
# using the server's pg_dump (the client on this machine may be older).
platform_schemas=(auth storage realtime graphql_public supabase_functions)
dump_args=()
for schema in "${platform_schemas[@]}"; do dump_args+=(-n "$schema"); done
# Names of this run's own (two rehearsals at once must not share files).
dump_file="/tmp/platform-${name}-$$.dump"
list_file="/tmp/platform-${name}-$$.list"
trap 'docker exec "$container" rm -f "$dump_file" "$list_file" > /dev/null 2>&1 || true' EXIT
docker exec "$container" pg_dump -U supabase_admin -d postgres --schema-only -Fc "${dump_args[@]}" -f "$dump_file"

# Leave out what the app added: every policy, and the triggers whose
# function lives outside auth and storage (the same rule platform-extras.sql
# uses to write them into a backup).
app_triggers=$("${admin[@]}" -d postgres -c "
  select t.tgname from pg_trigger t
    join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_proc f on f.oid = t.tgfoid join pg_namespace fn on fn.oid = f.pronamespace
   where not t.tgisinternal and n.nspname in ('auth', 'storage') and fn.nspname not in ('auth', 'storage')")
list=$(docker exec "$container" pg_restore -l "$dump_file" | grep -v ' POLICY ')
while read -r trigger; do
  [[ -n "$trigger" ]] && list=$(grep -vE " TRIGGER [a-z_]+ [a-z_]+ ${trigger} " <<< "$list")
done <<< "$app_triggers"
# shellcheck disable=SC2016 # expanded by the container's shell
docker exec -i "$container" sh -c 'cat > "$1"' _ "$list_file" <<< "$list"
docker exec "$container" pg_restore -U supabase_admin -d "$name" --exit-on-error -L "$list_file" "$dump_file"

echo "Created ${name}: an empty database shaped like a new Supabase project."
echo "Restore into it with (local password: postgres):"
echo "  AGE_IDENTITY_FILE=<a throwaway rehearsal key> EXPECTED_SHA256=<the sha256 create-backup.sh or bucket.sh fetch printed> \\"
echo "  TARGET_DB_URL=postgresql://postgres@${host}:${port}/${name} PGPASSWORD=postgres \\"
echo "  PROTECT_DB_URL=postgresql://postgres@${host}:${port}/postgres DRILL_LOCAL_CLUSTER=1 \\"
echo "    bash scripts/backup/restore-drill.sh <archive>"
