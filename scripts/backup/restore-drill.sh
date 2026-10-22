#!/usr/bin/env bash
# Restore drill: proves a backup can be turned back into a working database
# and file store, and that nothing was lost on the way (DATA-001;
# docs/runbooks/backup-recovery.md, "Restore drill").
#
#   AGE_IDENTITY_FILE=~/qbbe-backup-key.txt \
#   EXPECTED_SHA256=<the archive's sha256 from the summary of the green Backup run> \
#   TARGET_DB_URL='postgresql://postgres.<scratch ref>@<pooler host>:5432/postgres' \
#   PGPASSWORD=<the scratch project's database password> \
#   PROTECT_DB_URL='postgresql://postgres.<production ref>@<pooler host>:5432/postgres' \
#   PROTECT_SUPABASE_URL=https://<production ref>.supabase.co \
#   TARGET_SUPABASE_URL=https://<scratch ref>.supabase.co TARGET_SERVICE_ROLE_KEY=… \
#     bash scripts/backup/restore-drill.sh <fetched-dir>/qbbe-production-<time>.tar.gz.age
#
# The archive and its blobs come from `scripts/backup/bucket.sh fetch`, which
# puts the blobs in <fetched-dir>/blobs (BACKUP_BLOB_DIR to use another).
# Database addresses never hold the password: it goes in PGPASSWORD (read it
# without echo: `read -rs PGPASSWORD; export PGPASSWORD`), so it shows in
# no process list. An address with a password is refused. A target that is
# not on this computer is reached over TLS only (PGSSLMODE=require is set
# unless the address or PGSSLMODE already asks for it; weaker is refused).
#
# EXPECTED_SHA256 is required: the archive's sha256 as the summary of the
# green Backup run that made it shows (GitHub, Actions, Backup). The drill
# refuses to decrypt an archive with any other sha256, because anyone who
# can write to the bucket could have put a different one there. For the
# local rehearsal, use the sha256 create-backup.sh or bucket.sh fetch printed.
#
# A restore drill must never touch production. It refuses to start unless
# PROTECT_DB_URL names the database(s) to keep away from (production's; no
# password needed in it), and refuses a target that is one of them or
# belongs to a protected project, a file target that is not the same
# project as the database target, and a target database that already holds
# the app's tables (lib.mjs checkRestoreTarget; tested in
# tests/unit/backup-lib.test.ts).
#
# What it does, in order, stopping at the first step that fails:
#   1. checks the archive's sha256 against EXPECTED_SHA256, then decrypts it
#      with the custodian's age identity (private key) file, and each file's
#      blob, into a private temporary folder removed on exit;
#   2. checks every SQL file and uploaded file against the manifest's
#      sha256, and each file against the size and MD5 the database recorded;
#   3. restores the database exactly as Supabase documents it, in one
#      transaction with ON_ERROR_STOP: roles, schema,
#      `SET session_replication_role = replica`, data, then the migration
#      history;
#   4. with TARGET_SUPABASE_URL and TARGET_SERVICE_ROLE_KEY, uploads every
#      file to the target project, downloads it again to compare, and puts
#      back who owns each file;
#   5. applies platform.sql (storage policies, auth and storage triggers,
#      queues, the job schedule) last, as pg_dump puts triggers after data.
#      Every scheduled job is restored paused, so none runs in the target
#      (a drill leaves them so); the report ends with the statement that
#      starts the ones that ran in the backup, for a real restore once its
#      job runner is wired (runbook, Restore);
#   6. checks the load is complete (rows per table, the migration history
#      included; policies, triggers, queues and schedules; each bucket's
#      settings; and every file row has its file) and prints a report with
#      times, ending RESULT: PASS, PARTIAL or FAIL.
#
# Step 3 is all or nothing: if it fails it is rolled back, and the same
# command can simply be run again. Steps 4 and 5 are separate. If one of
# them fails, fix the cause and run the same command again with RESUME=files
# (from step 4) or RESUME=platform (from step 5): it then skips the
# empty-target check and the database load, after checking that the target
# holds exactly the backup's rows. RESUME=platform is refused while an
# earlier file restore is unfinished.
#
# ALLOW_MISSING_FILES=1 (never the default) is for a backup some of whose
# file blobs are missing or damaged. The SQL files must still match their
# sha256. The files that cannot be given back are listed (on this screen
# only), the database and every other file are restored, and the result is
# PARTIAL (exit 2), never PASS.
#
# DRILL_LOCAL_CLUSTER=1 is for the local rehearsal only, where the target is
# a scratch database inside the local stack's Postgres
# (scripts/backup/local-scratch-db.sh). There, roles already exist for the
# whole server, so CREATE ROLE tolerates "already exists" (roles only), and
# pg_cron can only live in the stack's own database, so the schedule is left
# out and reported as not checked.
#
# Runs on Linux, WSL and macOS with bash 4.4 or newer (on a Mac: `brew
# install bash`, then `bash scripts/backup/restore-drill.sh …`).

set -euo pipefail

fail() { echo "FAIL: $*" >&2; exit 1; }
if (( BASH_VERSINFO[0] < 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] < 4) )); then
  fail "This script needs bash 4.4 or newer (this is ${BASH_VERSION}). On a Mac: brew install bash, then run it as: bash scripts/backup/restore-drill.sh …"
fi

archive="${1:-}"
[[ -f "$archive" ]] || fail "Usage: bash scripts/backup/restore-drill.sh <backup.tar.gz.age>"
archive=$(cd "$(dirname "$archive")" && pwd)/$(basename "$archive")
blob_dir="${BACKUP_BLOB_DIR:-$(dirname "$archive")/blobs}"
cd "$(dirname "$0")/../.."

for name in AGE_IDENTITY_FILE EXPECTED_SHA256 TARGET_DB_URL PROTECT_DB_URL; do
  [[ -n "${!name:-}" ]] || fail "Missing ${name}. See the header of this script."
done
expected_sha=$(tr 'A-F' 'a-f' <<< "$EXPECTED_SHA256")
[[ "$expected_sha" =~ ^[0-9a-f]{64}$ ]] \
  || fail "EXPECTED_SHA256 must be the 64-character sha256 from the summary of the Backup run that made this archive."
[[ -f "$AGE_IDENTITY_FILE" ]] || fail "AGE_IDENTITY_FILE (${AGE_IDENTITY_FILE}) is not a file."
for tool in age psql tar node; do
  if ! command -v "$tool" > /dev/null; then
    if [[ "$tool" == psql && "$(uname -s)" == Darwin ]]; then
      # shellcheck disable=SC2016 # printed for the custodian to run
      fail 'psql is not on PATH. On a Mac, Homebrew keeps it out of the PATH: run export PATH="$(brew --prefix libpq)/bin:$PATH" in this terminal, then run this command again.'
    fi
    fail "${tool} is not installed."
  fi
done
if node --input-type=module -e 'import { urlHasPassword } from "./scripts/backup/lib.mjs"; process.exit(urlHasPassword(process.env.TARGET_DB_URL) ? 0 : 1);'; then
  fail "TARGET_DB_URL holds a password. Give the address without it, and the password in PGPASSWORD (read -rs PGPASSWORD; export PGPASSWORD), so it never shows in the process list."
fi
tls=$(node --input-type=module -e '
  import { databaseTls } from "./scripts/backup/lib.mjs";
  try { console.log(databaseTls(process.env.TARGET_DB_URL, process.env.PGSSLMODE).mode ?? ""); }
  catch (error) { console.error(error.message); process.exit(1); }
') || fail "TARGET_DB_URL: see the line above."
if [[ -n "$tls" ]]; then export PGSSLMODE="$tls"; fi
if [[ -n "${TARGET_SUPABASE_URL:-}" && -z "${TARGET_SERVICE_ROLE_KEY:-}" ]]; then
  fail "TARGET_SUPABASE_URL is set without TARGET_SERVICE_ROLE_KEY."
fi
resume="${RESUME:-}"
[[ "$resume" =~ ^(|files|platform)$ ]] || fail "RESUME must be files or platform."
allow_missing="${ALLOW_MISSING_FILES:-0}"
[[ "$allow_missing" =~ ^(0|1)$ ]] || fail "ALLOW_MISSING_FILES must be 1 (or left out)."
local_cluster="${DRILL_LOCAL_CLUSTER:-0}"

# Refuse production before anything else happens.
node scripts/backup/manifest.mjs guard

now_ms() { node -e 'console.log(Date.now())'; }
seconds_since() { node -e 'console.log(((Date.now() - Number(process.argv[1])) / 1000).toFixed(1))' "$1"; }
started=$(now_ms)
umask 077
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
db="$work/db"
results=()
record() { results+=("$1"); }
report() {
  echo
  echo "== Restore drill report: backup of ${environment:-?} made ${created:-?}"
  if [[ "$local_cluster" == "1" ]]; then echo "   (local rehearsal, not the hosted drill)"; fi
  if [[ "$allow_missing" == "1" ]]; then echo "   (ALLOW_MISSING_FILES=1: a partial restore was allowed)"; fi
  printf '%s\n' "${results[@]}"
}
stop() {
  record "FAIL  $1"
  report
  echo "RESULT: FAIL"
  fail "$2"
}

echo "== 1. Check the archive is the one the Backup run made, decrypt and unpack"
t=$(now_ms)
got_sha=$(node -e '
  const h = require("crypto").createHash("sha256");
  require("fs").createReadStream(process.argv[1]).on("data", (d) => h.update(d)).on("end", () => console.log(h.digest("hex")))
    .on("error", (e) => { console.error(e.message); process.exit(1); });
' "$archive")
[[ "$got_sha" == "$expected_sha" ]] \
  || fail "The archive's sha256 is ${got_sha}, not EXPECTED_SHA256 (${expected_sha}). Refusing to decrypt it: it may not be the archive that Backup run made. Fetch the run named in that summary (bucket.sh fetch <environment> <its time or archive name>) and compare again."
echo "Archive sha256 matches EXPECTED_SHA256."
age -d -i "$AGE_IDENTITY_FILE" "$archive" | tar -xzf - -C "$work" \
  || fail "Could not decrypt the archive with ${AGE_IDENTITY_FILE}. Is it a custodian's key for this backup?"
{ read -r environment; read -r created; } < <(node scripts/backup/manifest.mjs info "$work")
AGE_IDENTITY_FILE="$AGE_IDENTITY_FILE" node scripts/backup/manifest.mjs unpack-blobs "$work" "$blob_dir" || true
decrypt_s=$(seconds_since "$t")
record "PASS  archive: its sha256 is the one the Backup run's summary shows"
echo "Backup of ${environment}, made ${created}. Unpacked in ${decrypt_s}s."

echo "== 2. Check every file against the manifest"
partial=0
if [[ "$allow_missing" == "1" ]]; then
  if node scripts/backup/manifest.mjs check-files "$work" --remove-bad; then
    record "PASS  backup: every SQL file and uploaded file matches its manifest sha256"
  elif node scripts/backup/manifest.mjs check-files "$work" --db-only > /dev/null; then
    lost=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).length)' "$work/lost-files.json")
    partial=1
    record "PARTIAL  uploaded files: ${lost} missing, damaged or not decryptable (listed above); the database and the other files are restored anyway (ALLOW_MISSING_FILES=1)"
  else
    stop "backup: the SQL files do not match the manifest" "The database part of this backup is damaged; ALLOW_MISSING_FILES does not cover that. Nothing was restored. Use another night's backup."
  fi
elif node scripts/backup/manifest.mjs check-files "$work"; then
  record "PASS  backup: every SQL file and uploaded file matches its manifest sha256"
else
  stop "backup: files are missing or do not match the manifest" "The backup is damaged or incomplete (or a blob is missing from ${blob_dir}); nothing was restored. To restore the database and the intact files anyway, run the same command with ALLOW_MISSING_FILES=1 (runbook, Restore)."
fi

echo "== Preflight: the target"
q() { psql "$TARGET_DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 -c "$1"; }
q "select 1" > /dev/null || fail "Cannot connect to TARGET_DB_URL (with the password in PGPASSWORD)."
node --input-type=module -e 'import { PLATFORM_COUNT_QUERY } from "./scripts/backup/lib.mjs"; process.stdout.write(PLATFORM_COUNT_QUERY);' > "$work/platform-count.sql"
node scripts/backup/manifest.mjs count-sql "$work" > "$work/count.sql"
existing=$(q "select count(*) from pg_tables where schemaname in ('public', 'app')")
if [[ -z "$resume" ]]; then
  [[ "$existing" == "0" ]] \
    || fail "The target already has ${existing} tables in public/app. A drill restores only into a new, empty project. (To finish an earlier run whose database step succeeded, use RESUME=files or RESUME=platform as it said.)"
  # Schemas the data goes into that neither the schema file creates nor the
  # target already has. supabase_functions exists only once Database
  # Webhooks are turned on in the target project.
  needed=$(grep -oE '^COPY "[^"]+"' "$db/data.sql" | sed -E 's/^COPY "([^"]+)"/\1/' | sort -u)
  created_schemas=$(grep -oE '^CREATE SCHEMA IF NOT EXISTS "[^"]+"' "$db/schema.sql" | sed -E 's/.*"([^"]+)"$/\1/' | sort -u)
  present=$(q "select nspname from pg_namespace" | sort -u)
  missing=$(comm -23 <(printf '%s\n' "$needed") <(printf '%s\n%s\n' "$created_schemas" "$present" | sort -u) | tr '\n' ' ')
  [[ -z "${missing// /}" ]] \
    || fail "The target has no schema ${missing}which the backup's data needs. For supabase_functions, turn on Database Webhooks in the target project (Database, Webhooks, Enable) and run the drill again."
else
  echo "RESUME=${resume}: checking the target already holds exactly this backup's rows."
  psql "$TARGET_DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 -f "$work/count.sql" > "$work/rows.txt" \
    || fail "RESUME=${resume}: the target does not have the backup's tables. Run without RESUME into a new project."
  node scripts/backup/manifest.mjs compare-rows "$work" "$work/rows.txt" > /dev/null \
    || fail "RESUME=${resume}: the target's rows are not this backup's. Run without RESUME into a new project."
  unfinished=$(q "select to_regnamespace('restore_drill_keep') is not null")
  if [[ "$unfinished" == t && ( "$resume" == platform || -z "${TARGET_SUPABASE_URL:-}" ) ]]; then
    fail "The file restore (step 4) of an earlier run did not finish (restore_drill_keep is still in the target). Run again with RESUME=files and TARGET_SUPABASE_URL and TARGET_SERVICE_ROLE_KEY set."
  fi
  if [[ "$resume" == files ]]; then
    [[ -n "${TARGET_SUPABASE_URL:-}" ]] \
      || fail "RESUME=files restores the uploaded files: set TARGET_SUPABASE_URL and TARGET_SERVICE_ROLE_KEY."
    triggers=$(psql "$TARGET_DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 -f "$work/platform-count.sql" | grep '^triggers|' | cut -d'|' -f2)
    [[ "$triggers" == "0" ]] \
      || fail "RESUME=files: platform.sql has already been applied, and its triggers would refuse replacing files. Use a new project."
  fi
  record "SKIP  database load: done by an earlier run (RESUME=${resume}; the target's rows equal the backup's)"
  if [[ "$resume" == platform ]]; then
    record "SKIP  uploaded files: not part of this run (RESUME=platform); an earlier run restored them, or they were checked inside the backup only"
  fi
fi

# Supabase's troubleshooting notes for this restore say to comment out the
# grants the platform makes itself, which `postgres` is not allowed to make
# (cli_login_postgres; and, seen in the local rehearsal on 2026-10-22,
# GRANT SET ON PARAMETER "log_min_messages" TO "supabase_realtime_admin").
# Only those are left out, each printed; any other grant, such as an app
# role granted to authenticator, stays and must succeed.
mkdir "$work/prepared"
platform_grant='^(GRANT (SET|ALTER SYSTEM)( ?, ?(SET|ALTER SYSTEM))? ON PARAMETER .*;|GRANT .* TO "(cli_login_[^"]*|supabase_[^"]*)"( .*)?;|GRANT "cli_login_[^"]*" TO .*;)$'
grep -E "$platform_grant" "$db/roles.sql" | sed 's/^/      left out of roles.sql: /' || true
sed -E "s/${platform_grant//\//\\/}/-- left out, the platform's own grant: &/" "$db/roles.sql" > "$work/prepared/roles.sql"
roles="$work/prepared/roles.sql"
schema="$db/schema.sql"
platform="$db/platform.sql"
platform_skip=()
schedules_note=""
if [[ "$local_cluster" == "1" ]]; then
  echo "== LOCAL REHEARSAL MODE (DRILL_LOCAL_CLUSTER=1): not the hosted drill"
  mkdir "$work/local"
  # Roles belong to the whole Postgres server, and the source database is on
  # this same server, so they exist already. Only CREATE ROLE is allowed to
  # find its role present; every other statement still stops the restore.
  # shellcheck disable=SC2016
  sed -E 's/^(CREATE ROLE "[^"]+".*;)$/DO $drill$ BEGIN \1 EXCEPTION WHEN duplicate_object THEN RAISE NOTICE '\''role exists'\''; END $drill$;/' \
    "$roles" > "$work/local/roles.sql"
  roles="$work/local/roles.sql"
  echo "roles.sql: CREATE ROLE tolerates an existing role ($(grep -c '^CREATE ROLE' "$db/roles.sql" || true) statements)."
  # pg_cron can be created only in the server's own database (postgres).
  grep -v '^CREATE EXTENSION IF NOT EXISTS "pg_cron"' "$db/schema.sql" > "$work/local/schema.sql"
  schema="$work/local/schema.sql"
  grep -vE '^SELECT cron\.(schedule|alter_job)\(' "$db/platform.sql" > "$work/local/platform.sql"
  platform="$work/local/platform.sql"
  platform_skip=(--skip cronJobs)
  schedules_note=" (schedules not checked locally)"
  echo "schema.sql, platform.sql: pg_cron and its $(grep -c '^SELECT cron.schedule(' "$db/platform.sql" || true) scheduled jobs left out (pg_cron lives only in the stack's own database)."
fi

db_s="-"
if [[ -z "$resume" ]]; then
  echo "== 3. Restore the database (one transaction: roles, schema, replica mode, data, migration history)"
  t=$(now_ms)
  psql "$TARGET_DB_URL" -X -q \
    --single-transaction \
    --variable ON_ERROR_STOP=1 \
    --file "$roles" \
    --file "$schema" \
    --command 'SET session_replication_role = replica' \
    --file "$db/data.sql" \
    --file "$db/history_schema.sql" \
    --file "$db/history_data.sql" \
    > "$work/restore.log" 2>&1 \
    || { tail -n 20 "$work/restore.log"; fail "The database restore stopped; it was rolled back (the target is unchanged). Fix the cause and run the same command again (no RESUME)."; }
  db_s=$(seconds_since "$t")
  record "PASS  database: loaded in one transaction, the migration history included"
  echo "Database restored in ${db_s}s."
fi

storage_s="-"
lost_args=()
if [[ "$partial" == "1" ]]; then lost_args=(--lost "$work/lost-files.json"); fi
if [[ "$resume" != platform ]]; then
  if [[ -n "${TARGET_SUPABASE_URL:-}" ]]; then
    echo "== 4. Restore uploaded files to ${TARGET_SUPABASE_URL}"
    # Storage's upload may rewrite who owns each file's row; keep the
    # backed-up owners aside (once: a resumed run keeps the first copy) and
    # put them back after the upload.
    q "create schema if not exists restore_drill_keep;
       create table if not exists restore_drill_keep.objects as
         select bucket_id, name, owner, owner_id, user_metadata from storage.objects" > /dev/null
    t=$(now_ms)
    if ! ALLOW_MISSING_FILES="$partial" node scripts/backup/restore-storage.mjs "$work"; then
      storage_s=$(seconds_since "$t")
      stop "uploaded files: see the storage lines above (restore_drill_keep.objects keeps the owners)" \
        "The file restore did not complete. Fix the cause (for example the project's upload size limit, Storage settings), then run the same command with RESUME=files."
    fi
    storage_s=$(seconds_since "$t")
    if [[ "$partial" == "1" ]]; then
      record "PARTIAL  uploaded files: every file the backup could give back uploaded, downloaded again and matching its sha256; the rest are listed in step 2"
    else
      record "PASS  uploaded files: every file uploaded, downloaded again and matching its sha256"
    fi
    if fixed=$(psql "$TARGET_DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 --single-transaction <<'SQL'
set session_replication_role = replica;
with fixed as (
  update storage.objects o
     set owner = k.owner, owner_id = k.owner_id, user_metadata = k.user_metadata
    from restore_drill_keep.objects k
   where o.bucket_id = k.bucket_id and o.name = k.name
     and (o.owner, o.owner_id, o.user_metadata) is distinct from (k.owner, k.owner_id, k.user_metadata)
  returning 1)
select count(*) from fixed;
drop schema restore_drill_keep cascade;
SQL
    ); then
      record "PASS  file owners: as backed up (${fixed} row(s) the upload had changed were put back)"
    else
      stop "file owners: could not be put back; restore_drill_keep.objects in the target still holds them" \
        "Putting back the file owners failed. Fix the cause, then run again with RESUME=files."
    fi
  else
    record "SKIP  uploaded files: no TARGET_SUPABASE_URL, so files were checked inside the backup only (step 2)"
  fi
fi

echo "== 5. Policies, triggers, queues, schedules (platform.sql)"
psql "$TARGET_DB_URL" -X -q --single-transaction --variable ON_ERROR_STOP=1 --file "$platform" \
  >> "$work/restore.log" 2>&1 \
  || { tail -n 20 "$work/restore.log"; stop "platform.sql: rolled back" "platform.sql failed and was rolled back. Fix the cause, then run again with RESUME=platform."; }

echo "== 6. Is the load complete?"
t=$(now_ms)
psql "$TARGET_DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 -f "$work/count.sql" > "$work/rows.txt"
tables=$(grep -c . "$work/rows.txt" || true)
if node scripts/backup/manifest.mjs compare-rows "$work" "$work/rows.txt"; then
  record "PASS  load complete: rows in each of ${tables} tables equal the backup's (data.sql and the migration history)"
else
  record "FAIL  load incomplete: some tables differ from the backup (listed above)"
fi
psql "$TARGET_DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 -f "$work/platform-count.sql" > "$work/platform.txt"
if node scripts/backup/manifest.mjs compare-platform "$work" "$work/platform.txt" ${platform_skip[@]+"${platform_skip[@]}"}; then
  record "PASS  policies, triggers, queues, schedules: same counts as platform.sql${schedules_note}"
else
  record "FAIL  policies, triggers, queues or schedules differ from platform.sql (listed above)"
fi
q "select coalesce(json_agg(json_build_array(id, public, file_size_limit, allowed_mime_types) order by id), '[]') from storage.buckets" > "$work/buckets.json"
if node scripts/backup/manifest.mjs compare-buckets "$work" "$work/buckets.json"; then
  record "PASS  bucket settings: public flag, size limit and file types as backed up"
else
  record "FAIL  bucket settings differ from the backup (listed above)"
fi
q "select coalesce(json_agg(json_build_array(bucket_id, name)), '[]') from storage.objects" > "$work/file-rows.json"
if node scripts/backup/manifest.mjs compare-file-rows "$work" "$work/file-rows.json" ${lost_args[@]+"${lost_args[@]}"}; then
  record "PASS  file rows: every restored storage.objects row has its file in the backup (files deleted at the source during the backup are reported, not failed${lost_args[*]:+; files a partial restore could not give back are counted above})"
else
  record "FAIL  file rows: some restored storage.objects rows have no file in the backup (listed above)"
fi
for table in auth.users auth.identities auth.mfa_factors storage.objects; do
  echo "      ${table}: $(grep -E "^${table//./\\.}\|" "$work/rows.txt" | cut -d'|' -f2)"
done
verify_s=$(seconds_since "$t")

total_s=$(seconds_since "$started")
report
echo "These checks show the restore loaded everything the backup holds. Whether the backup captured everything is checked every night when it is made (tables with rows against the dump, files against the database)."
echo "Times: decrypt ${decrypt_s}s, database ${db_s}s, files ${storage_s}s, checks ${verify_s}s, total ${total_s}s."
start_schedule=$(sed -n 's/^-- start-schedule: //p' "$db/platform.sql" | head -n 1)
if [[ "$local_cluster" != "1" && -n "$start_schedule" ]]; then
  echo "Scheduled jobs: restored paused, so none of them runs in the target. A drill leaves them paused. In a real restore, once the job runner is wired (runbook, Restore), start the ones that ran in the backup with:"
  echo "  psql \"\$TARGET_DB_URL\" -X -v ON_ERROR_STOP=1 -c \"${start_schedule}\""
fi
if printf '%s\n' "${results[@]}" | grep -q '^FAIL'; then
  echo "RESULT: FAIL"
  exit 1
fi
if printf '%s\n' "${results[@]}" | grep -q '^PARTIAL'; then
  echo "RESULT: PARTIAL (the database is restored; the files listed in step 2 are not. Record them as lost, and look for them in an older backup.)"
  exit 2
fi
echo "RESULT: PASS"
echo "Next, by hand: point a preview of the app at the target project and sign in, with an MFA code (docs/runbooks/backup-recovery.md)."
