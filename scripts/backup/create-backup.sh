#!/usr/bin/env bash
# Makes one encrypted backup of one environment: its database, and every
# uploaded file as an encrypted blob, readable only by the backup custodians
# (DATA-001; docs/runbooks/backup-recovery.md).
#
#   BACKUP_DB_URL=postgresql://<user>@<host>:<port>/<database> PGPASSWORD=… \
#   SUPABASE_URL=https://<ref>.supabase.co (or SUPABASE_PROJECT_REF=<ref>) \
#   SUPABASE_SERVICE_ROLE_KEY=… BACKUP_AGE_RECIPIENT="age1… age1…" \
#   BACKUP_INDEX_KEY=… [BACKUP_STATE_DIR=<from bucket.sh state>] \
#     scripts/backup/create-backup.sh <out-dir> <staging|production|local>
#
# The database address holds no password: psql, pg_dump and the Supabase
# CLI read it from PGPASSWORD (or a private pgpass file named by
# PGPASSFILE), so it is never on a command line. An address with a password
# is refused. For a database that is not on this computer, PGSSLMODE=require
# is set unless the address (sslmode=require or verify-full) or PGSSLMODE
# already asks for it, and anything weaker is refused (lib.mjs
# databaseTls). That makes every psql call here require TLS. The three
# `supabase db dump` calls do not obey sslmode or PGSSLMODE: the CLI uses
# TLS when the server offers it (Supabase's hosted database always does),
# but does not refuse a connection downgraded to plain text.
#
# Called by .github/workflows/backup.yml every night, and by hand for the
# local rehearsal (SUPABASE_BIN="npx supabase" when the CLI is not on PATH).
# bucket.sh then uploads what it made.
#
# It makes, in <out-dir>:
#   qbbe-<environment>-<UTC time>.tar.gz.age   the archive, holding
#       db/roles.sql, db/schema.sql, db/data.sql   Supabase's documented
#                                                  three-part dump
#       db/history_schema.sql, db/history_data.sql the migration history, so
#                                                  the next deploy's `db push`
#                                                  knows what a restored
#                                                  project has (one psql call:
#                                                  migration-history.sql)
#       db/platform.sql                            what the three parts leave
#                                                  out (platform-extras.sql)
#       manifest.json                              sizes, sha256s, rows per
#                                                  table, every file and its blob
#   qbbe-<environment>-<UTC time>.index.json   unencrypted, names no file,
#                                              signed with BACKUP_INDEX_KEY: the
#                                              blobs the archive needs, for the
#                                              next night and for a restore
#   blobs/<sha256>.age                         new file blobs
#                                              (export-storage.mjs)
#   summary.md, backup.env                     for the workflow
#
# Everything is encrypted with age to the public keys in BACKUP_AGE_RECIPIENT;
# no private key is ever needed here. Unencrypted database files exist only
# in a private temporary folder removed on exit, success or not; files are
# encrypted as they download and never touch the disk in plain form.
#
# Exit status: 0 complete; 3 the archive was made but is incomplete (a file
# could not be copied, or a table with rows is missing from the dump; the
# manifest names them); anything else, no archive.

set -euo pipefail

fail() { echo "::error::$*" >&2; exit 1; }

out="${1:-}"
environment="${2:-}"
[[ -n "$out" && "$environment" =~ ^(staging|production|local)$ ]] \
  || fail "Usage: scripts/backup/create-backup.sh <out-dir> <staging|production|local>"
umask 077
mkdir -p "$out"
out=$(cd "$out" && pwd)
cd "$(dirname "$0")/../.."

if [[ -z "${SUPABASE_URL:-}" && -n "${SUPABASE_PROJECT_REF:-}" ]]; then
  SUPABASE_URL="https://${SUPABASE_PROJECT_REF}.supabase.co"
fi
for name in BACKUP_DB_URL SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY BACKUP_AGE_RECIPIENT BACKUP_INDEX_KEY; do
  [[ -n "${!name:-}" ]] || fail "Missing ${name}."
done
export SUPABASE_URL BACKUP_DB_URL
for tool in "${AGE_BIN:-age}" psql tar node sha256sum; do
  command -v "$tool" > /dev/null || fail "${tool} is not installed."
done
read -r -a supabase <<< "${SUPABASE_BIN:-supabase}"
generation="${BACKUP_GENERATION:-$(date -u +%Y-%m)}"
[[ "$generation" =~ ^[0-9]{4}-(0[1-9]|1[0-2])$ ]] || fail "BACKUP_GENERATION must be YYYY-MM."

# The settings that would only fail later, checked before anything is read:
# no password in the address, the index key's length, and the recipients
# (lib.mjs refuses anything that is not an age public key, such as a
# private key pasted by mistake). One -r per custodian's public key.
node --input-type=module -e '
  import { parseIndexKey, urlHasPassword } from "./scripts/backup/lib.mjs";
  if (urlHasPassword(process.env.BACKUP_DB_URL)) { console.error("BACKUP_DB_URL holds a password: give it in PGPASSWORD instead."); process.exit(1); }
  try { parseIndexKey(process.env.BACKUP_INDEX_KEY); } catch (error) { console.error(error.message); process.exit(1); }
' || fail "A backup setting is not usable (see the line above)."
tls=$(node --input-type=module -e '
  import { databaseTls } from "./scripts/backup/lib.mjs";
  try { console.log(databaseTls(process.env.BACKUP_DB_URL, process.env.PGSSLMODE).mode ?? ""); }
  catch (error) { console.error(error.message); process.exit(1); }
') || fail "BACKUP_DB_URL: see the line above."
if [[ -n "$tls" ]]; then export PGSSLMODE="$tls"; fi
recipients=$(node --input-type=module -e '
  import { parseRecipients } from "./scripts/backup/lib.mjs";
  try { console.log(parseRecipients(process.env.BACKUP_AGE_RECIPIENT).join("\n")); }
  catch (error) { console.error(error.message); process.exit(1); }
') || fail "BACKUP_AGE_RECIPIENT is not a list of age public keys."
age_args=()
while read -r recipient; do age_args+=(-r "$recipient"); done <<< "$recipients"
# The blob folder for this month and these keys (lib.mjs blobPrefix).
blob_prefix=$(node --input-type=module -e '
  import { blobPrefix, parseRecipients, recipientTag } from "./scripts/backup/lib.mjs";
  console.log(blobPrefix(process.argv[1], process.argv[2], recipientTag(parseRecipients(process.env.BACKUP_AGE_RECIPIENT))));
' "$environment" "$generation")

rm -rf "$out/blobs" "$out/index-files.json"
work=$(mktemp -d "${out}/work.XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir "$work/db"

started=$SECONDS
step() { echo "== $* ($(( SECONDS - started ))s)"; }
sql() { psql "$BACKUP_DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }
migration_version() {
  sql -c "select coalesce(case when to_regclass('supabase_migrations.schema_migrations') is not null then
            (xpath('//v/text()', query_to_xml('select max(version) as v from supabase_migrations.schema_migrations', false, false, '')))[1]::text
          end, '')"
}

node --input-type=module -e 'import { TABLES_WITH_ROWS_QUERY } from "./scripts/backup/lib.mjs"; process.stdout.write(TABLES_WITH_ROWS_QUERY);' > "$work/tables-with-rows.sql"

# The dumps are separate snapshots. A deploy that adds a migration between
# them could leave a schema and data that do not fit together, so the
# latest migration is compared before and after, and the dumps (and the
# probe of which tables hold rows, so it describes the same schema) redone
# once if it moved.
for attempt in 1 2; do
  before=$(migration_version)
  step "Database: which tables hold rows (checked against the dump later)"
  sql -f "$work/tables-with-rows.sql" > "$work/source-tables.txt"

  step "Database: roles, schema, data (Supabase's three-part dump)"
  # The CLI uses TLS when the server offers it, but, unlike psql, does not
  # enforce the sslmode / PGSSLMODE set above (see the top of this file).
  "${supabase[@]}" db dump --db-url "$BACKUP_DB_URL" -f "$work/db/roles.sql" --role-only
  "${supabase[@]}" db dump --db-url "$BACKUP_DB_URL" -f "$work/db/schema.sql"
  "${supabase[@]}" db dump --db-url "$BACKUP_DB_URL" -f "$work/db/data.sql" --use-copy --data-only \
    -x storage.buckets_vectors -x storage.vector_indexes

  step "Database: migration history (one query, not two more dumps)"
  sql -v schema_file="$work/db/history_schema.sql" -v data_file="$work/db/history_data.sql" \
    -f scripts/backup/migration-history.sql

  step "Database: storage policies, auth and storage triggers, queues, schedules"
  sql -f scripts/backup/platform-extras.sql > "$work/db/platform.sql"
  after=$(migration_version)
  [[ "$before" == "$after" ]] && break
  [[ "$attempt" == 1 ]] || fail "A migration was applied while the database was being dumped, twice in a row (${before} then ${after}). Run the backup again after the deploy."
  echo "A migration was applied during the dump (${before} then ${after}); dumping again."
  # The first attempt's reads count toward the night's Supabase traffic.
  cat "$work"/db/*.sql | wc -c | tr -d ' ' > "$work/redo-bytes.txt"
done
rm "$work/tables-with-rows.sql"
db_seconds=$(( SECONDS - started ))

step "Uploaded files: new or changed since the last backup (generation ${generation})"
status=0
storage_status=0
node scripts/backup/export-storage.mjs "$work" "$out" "$environment" "$generation" \
  || storage_status=$?
case "$storage_status" in
  0) ;;
  3) status=3; echo "::warning::Some uploaded files could not be copied. The backup continues without them; this run will be marked failed." ;;
  *)
    # Anything else (a crash) must not cost the night's database backup
    # either: record that the files are missing, and go on.
    status=3
    echo "::warning::The file export stopped (exit ${storage_status}). The database is still backed up; this run will be marked failed."
    if [[ ! -f "$work/storage/index.json" || ! -f "$out/index-files.json" ]]; then
      # shellcheck disable=SC2016 # JavaScript, not shell, expands ${…} here.
      node --input-type=module -e '
        import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
        import { parseRecipients, recipientTag, createRowCounter, storageFromDump } from "./scripts/backup/lib.mjs";
        const [work, out, prefix] = process.argv.slice(1);
        const tag = recipientTag(parseRecipients(process.env.BACKUP_AGE_RECIPIENT));
        let buckets = [];
        try {
          const counter = createRowCounter(["storage.buckets", "storage.objects"]);
          for (const line of readFileSync(`${work}/db/data.sql`, "utf8").split("\n")) counter.line(line);
          buckets = storageFromDump(counter.rows()).buckets;
        } catch {}
        mkdirSync(`${work}/storage`, { recursive: true, mode: 0o700 });
        const error = { bucket: "*", path: "*", error: "The file export stopped before writing its results; no file is in this backup" };
        writeFileSync(`${work}/storage/index.json`, JSON.stringify({ buckets, objects: [], blobPrefix: prefix, recipients: tag, blobs: [], errors: [error], warnings: [], deletedDuringBackup: [], skippedVersions: 0, read: { storageBytes: 0, storageFiles: 0 } }), { mode: 0o600 });
        writeFileSync(`${out}/index-files.json`, JSON.stringify({ recipients: tag, files: [], blobs: [] }), { mode: 0o600 });
      ' "$work" "$out" "$blob_prefix"
    fi
    ;;
esac
files_seconds=$(( SECONDS - started - db_seconds ))

step "Manifest, and a check of every database file against it before encrypting"
build_status=0
node scripts/backup/manifest.mjs build "$work" "$environment" "$generation" || build_status=$?
case "$build_status" in
  0) ;;
  3) status=3 ;;
  *) fail "Could not build the manifest (exit ${build_status})." ;;
esac
# --db-only: the files are already encrypted blobs. Its output names only
# the SQL files, never an uploaded file, so it is safe in a public log.
node scripts/backup/manifest.mjs check-files "$work" --db-only > "$work/check.txt" \
  || { cat "$work/check.txt"; fail "The backup does not match its own manifest."; }
rm "$work/check.txt"

step "Package and encrypt"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="${out}/qbbe-${environment}-${stamp}.tar.gz.age"
node scripts/backup/manifest.mjs summary "$work" > "${out}/summary.md"
tar -C "$work" -czf - manifest.json db | "${AGE_BIN:-age}" "${age_args[@]}" -o "$file"
[[ "$(head -c 21 "$file")" == "age-encryption.org/v1" ]] || fail "The archive is not an age file."
index_file=$(node scripts/backup/manifest.mjs index "$work" "$out" "$file")

size=$(wc -c < "$file" | tr -d ' ')
sha=$(sha256sum "$file" | cut -d' ' -f1)
mkdir -p "$out/blobs"
blob_count=$(find "$out/blobs" -name '*.age' | wc -l | tr -d ' ')
blob_bytes=$(find "$out/blobs" -name '*.age' -printf '%s\n' | awk '{ s += $1 } END { print s + 0 }')
total=$(( SECONDS - started ))
echo "Backup: ${file} (${size} bytes, sha256 ${sha})"
echo "New file blobs to upload to ${blob_prefix}: ${blob_count} (${blob_bytes} bytes)."
# What this run read from Supabase, and a ::warning:: when the month at
# this rate passes 2 GB for this environment; the figure in bytes goes to
# the workflow, whose alert job adds the environments together.
node scripts/backup/manifest.mjs traffic "$work" "$work/traffic-month.txt"
traffic_month=$(cat "$work/traffic-month.txt")
echo "Took ${total}s (database ${db_seconds}s, files ${files_seconds}s)."
{
  echo "BACKUP_FILE=${file}"
  echo "BACKUP_INDEX_FILE=${index_file}"
  echo "BACKUP_SIZE=${size}"
  echo "BACKUP_SHA256=${sha}"
  echo "BACKUP_SECONDS=${total}"
  echo "BACKUP_GENERATION=${generation}"
  echo "BACKUP_BLOB_PREFIX=${blob_prefix}"
  echo "BACKUP_TRAFFIC_MONTH_BYTES=${traffic_month}"
} > "${out}/backup.env"

exit "$status"
