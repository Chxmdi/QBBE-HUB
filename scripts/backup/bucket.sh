#!/usr/bin/env bash
# The off-site bucket that keeps the backups (DATA-001;
# docs/runbooks/backup-recovery.md).
#
#   BACKUP_S3_ENDPOINT=https://… BACKUP_S3_BUCKET=… BACKUP_S3_REGION=… \
#   BACKUP_S3_ACCESS_KEY_ID=… BACKUP_S3_SECRET_ACCESS_KEY=… \
#     BACKUP_AGE_RECIPIENT=… BACKUP_INDEX_KEY=… \
#       scripts/backup/bucket.sh state <environment> <YYYY-MM> <state-dir>
#     scripts/backup/bucket.sh push  <out-dir> <environment>
#     scripts/backup/bucket.sh fetch <environment> <which> <dest-dir>
#
# state  before a backup: what this month's blob folder holds, and the
#        newest index whose signature verifies (BACKUP_INDEX_KEY) and that
#        records the run its key names (archive name and time: a real older
#        index copied to a newer key is refused), among those of the last
#        40 days dated no more than an hour ahead. Newer ones that fail
#        (planted, copied, or signed with an old key) are skipped with one
#        warning giving their number; their keys are listed in
#        <state-dir>/ignored-indexes.txt. On the first night of a month (or
#        after a gap, or after a first night that failed), it brings the
#        blobs that index recorded into this month's folder: an object
#        already at a blob's name is downloaded and kept only if it has the
#        recorded encrypted size and sha256; otherwise the blob is copied
#        from last month's folder, through a private temporary file, checked
#        the same way, to the first free name (<sha256>.age, else
#        <sha256>.<n>.age). <state-dir>/carried.txt lists each one's sha256
#        and name. A blob that fails the check is not copied; its file is
#        downloaded again from Supabase instead. Needs BACKUP_AGE_RECIPIENT
#        (the folder is named after the keys) and BACKUP_INDEX_KEY.
# push   after create-backup.sh: uploads the new blobs, checks that every
#        blob the archive needs is in this month's folder, under its
#        recorded name, at the encrypted size its index records, then
#        uploads the archive and its index and reads each one back in full:
#        the downloaded bytes must have the local file's sha256. If the
#        blobs fail, the archive (the database) is still uploaded, without
#        its index, and the run fails; the blob names go to
#        <out-dir>/blob-check.txt, never to the log.
# fetch  for a restore: downloads one backup's archive, its index and every
#        blob it needs into a new <dest-dir>, and prints the archive's sha256
#        to compare with the Backup run's summary (or the outside monitor's
#        check-in log). <which> is `latest`, a date (YYYY-MM-DD: the newest
#        run of that day), or one run: its time (YYYYMMDDTHHMMSSZ), its
#        archive name or its key from the Backup run's summary. For `latest`
#        and a date, runs dated more than an hour ahead are ignored, and the
#        runs considered are listed with their archive's sha256, so a
#        custodian can pick another; a run whose index is valid but whose
#        archive is not in the bucket is skipped for the next one. Each blob
#        is taken from its recorded name, else from an identical copy in any
#        month folder of the same keys (both checked against the recorded
#        size and sha256), else
#        every copy found is saved for unpack-blobs, which keeps the one
#        that decrypts to the file's sha256. Needs no index key, so it cannot
#        check an index's signature: EXPECTED_SHA256 in the restore is the
#        guard.
#
# Layout in the bucket:
#   <environment>/<YYYY-MM-DD>/qbbe-<environment>-<time>.tar.gz.age   archive
#   <environment>/<YYYY-MM-DD>/qbbe-<environment>-<time>.index.json   its index
#   blobs/<environment>/<YYYY-MM>-<tag>/<sha256>.age                  one per file
# <tag> names the custodians' keys the blobs are encrypted to
# (lib.mjs recipientTag): a change of keys starts new folders. The lifecycle
# rules (runbook, setup step 4) delete archives after 35 days and blob
# folders after 70, so every kept archive still finds its blobs. A blob is
# <sha256>.age, or <sha256>.<n>.age when a run found that name taken by an
# object no signed index vouches for; the index records which.
#
# Any S3-compatible store works: Oracle Object Storage, Backblaze B2,
# Cloudflare R2, AWS S3. Uses the AWS CLI (installed on GitHub's runners),
# and only the calls every one of them documents: PutObject (and multipart
# upload), GetObject, HeadObject and ListObjects (version 1). It never
# deletes or overwrites anything, so its key needs no such permission, and
# every upload is from a complete local file, so a broken connection never
# leaves a short object behind. The access keys are passed in the
# environment only. Object keys hold dates and sha256s, never a file's name.
#
# Runs on Linux, WSL and macOS (bash 4.4 or newer: `brew install bash`).

set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)

fail() { echo "::error::$*" >&2; exit 1; }
if (( BASH_VERSINFO[0] < 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] < 4) )); then
  fail "This script needs bash 4.4 or newer (this is ${BASH_VERSION}). On a Mac: brew install bash, then run it as: bash scripts/backup/bucket.sh …"
fi

command="${1:-}"
shift || true
for name in BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_REGION BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY; do
  [[ -n "${!name:-}" ]] || fail "Missing ${name}."
done
for tool in aws node; do
  command -v "$tool" > /dev/null || fail "${tool} is not installed."
done

umask 077
export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$BACKUP_S3_REGION"
unset AWS_SESSION_TOKEN AWS_PROFILE
# Path-style addresses (endpoint/bucket/key) work on every provider above;
# Oracle's S3 endpoint accepts only those. Newer AWS CLIs also add CRC
# checksums some providers refuse; ask for them only where required.
private=$(mktemp -d)
cleanup() { rm -rf "$private"; }
trap cleanup EXIT
config="$private/aws-config"
printf '[default]\ns3 =\n  addressing_style = path\n' > "$config"
export AWS_CONFIG_FILE="$config"
export AWS_SHARED_CREDENTIALS_FILE=/dev/null
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
export AWS_PAGER=""
export BUCKET="$BACKUP_S3_BUCKET"
export ENDPOINT="$BACKUP_S3_ENDPOINT"
export PRIVATE="$private"

s3() { aws --endpoint-url "$ENDPOINT" "$@"; }
export -f s3
# sha256 of stdin or of a file, with Node (no sha256sum on a Mac).
sha256_of() {
  node -e '
    const h = require("crypto").createHash("sha256");
    const s = process.argv[1] ? require("fs").createReadStream(process.argv[1]) : process.stdin;
    s.on("data", (d) => h.update(d)).on("end", () => console.log(h.digest("hex"))).on("error", (e) => { console.error(e.message); process.exit(1); });
  ' "${1:-}"
}
export -f sha256_of
size_of() { wc -c < "$1" | tr -d ' '; }
export -f size_of
# key<TAB>size for every object under a prefix; the CLI follows the pages.
# ListObjects version 1 is the one Oracle documents; some stores (Supabase's
# own S3 endpoint, used by the local rehearsal) have only version 2.
list() {
  local listing
  listing=$(s3 s3api list-objects --bucket "$BUCKET" --prefix "$1" --query 'Contents[].[Key,Size]' --output text 2> /dev/null) \
    || listing=$(s3 s3api list-objects-v2 --bucket "$BUCKET" --prefix "$1" --query 'Contents[].[Key,Size]' --output text) \
    || return 1
  printf '%s\n' "$listing" | { grep -vE '^(None)?$' || true; }
}
# Runs a few lines of JavaScript with lib.mjs; a refusal prints its one-line
# reason, not a stack trace.
lib() { node --input-type=module -e "import * as lib from '${repo}/scripts/backup/lib.mjs'; try { $1 } catch (error) { console.error(error.message); process.exit(1); }" "${@:2}"; }

# Uploads a file and reads it back in full: the stored bytes must hash to
# the local file's sha256. (A size or metadata check alone would not notice
# bytes changed on the way.)
put_checked() {
  local file="$1" key="$2" want got
  want=$(sha256_of "$file")
  s3 s3 cp "$file" "s3://${BUCKET}/${key}" --only-show-errors --no-progress --content-type application/octet-stream \
    || fail "Upload to the backup bucket failed. Check BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_REGION and the access key's permission to write there."
  got=$(s3 s3 cp "s3://${BUCKET}/${key}" - --only-show-errors | sha256_of) \
    || fail "The upload finished but cannot be read back. The access key needs read permission on the bucket."
  [[ "$got" == "$want" ]] || fail "The stored copy of ${key} does not match the local file (sha256 ${got}, expected ${want})."
  echo "Uploaded s3://${BUCKET}/${key}: $(size_of "$file") bytes, sha256 ${want}, read back in full and matching."
}

# One blob into this month's folder (a line of carry-plan.txt: sha256,
# recorded size and sha256, its name in the old folder, the free name here,
# and the names here to check first). An object already here at the blob's
# name is downloaded and kept only if it has the recorded size and sha256
# (a copy a failed night left); otherwise the blob is downloaded from the
# old folder through a private temporary file, checked the same way, and
# uploaded under the free name. Prints "carried <sha256> <name> copied|
# checked", "occupied" (an object here that does not match), "rejected" or
# "failed", for counting; the log itself only ever shows the counts.
# shellcheck disable=SC2016 # expanded by the inner bash
carry_one='
  sha="$1" size="$2" want="$3" from="$4" to="$5" checks="$6"
  tmp=$(mktemp "${PRIVATE}/carry.XXXXXX") || { echo "failed $sha"; exit 0; }
  trap "rm -f \"$tmp\"" EXIT
  matches() { [[ "$(size_of "$tmp")" == "$size" && "$(sha256_of "$tmp")" == "$want" ]]; }
  if [[ "$checks" != - ]]; then
    IFS=, read -r -a names <<< "$checks"
    for name in "${names[@]}"; do
      s3 s3 cp "s3://${BUCKET}/${CURRENT}${name}" "$tmp" --only-show-errors --no-progress > /dev/null 2>&1 || continue
      if matches; then echo "carried $sha $name checked"; exit 0; fi
      echo "occupied $sha"
    done
  fi
  if ! s3 s3 cp "s3://${BUCKET}/${FROM}${from}" "$tmp" --only-show-errors --no-progress > /dev/null 2>&1; then
    echo "failed $sha"; exit 0
  fi
  matches || { echo "rejected $sha"; exit 0; }
  if s3 s3 cp "$tmp" "s3://${BUCKET}/${CURRENT}${to}" --only-show-errors --no-progress --content-type application/octet-stream > /dev/null 2>&1; then
    echo "carried $sha $to copied"
  else
    echo "failed $sha"
  fi
'

# One blob for a restore (a line of the fetch plan: sha256, then its
# candidates key|size|sha256|local name|kind separated by ";"). The first
# candidate with the recorded size and sha256 is saved and ends the search;
# a candidate that cannot be checked here ("-") is saved under its own
# local name and the search goes on. Prints "primary", "copy", "unchecked"
# or "missing" and the sha256.
# shellcheck disable=SC2016 # expanded by the inner bash
fetch_one='
  sha="$1" kept=0
  IFS=";" read -r -a candidates <<< "$2"
  for candidate in "${candidates[@]}"; do
    IFS="|" read -r key size want local kind <<< "$candidate"
    part="${DEST}/blobs/${local}.part"
    if ! s3 s3 cp "s3://${BUCKET}/${key}" "$part" --only-show-errors --no-progress > /dev/null 2>&1; then
      rm -f "$part"; continue
    fi
    if [[ "$want" != - ]]; then
      if [[ "$(size_of "$part")" == "$size" && "$(sha256_of "$part")" == "$want" ]]; then
        mv "$part" "${DEST}/blobs/${local}"; echo "$kind $sha"; exit 0
      fi
      rm -f "$part"; continue
    fi
    if [[ "$size" != - && "$(size_of "$part")" != "$size" ]]; then rm -f "$part"; continue; fi
    mv "$part" "${DEST}/blobs/${local}"; kept=$(( kept + 1 ))
  done
  if (( kept > 0 )); then echo "unchecked $sha"; else echo "missing $sha"; fi
'

case "$command" in
  state)
    environment="${1:-}" generation="${2:-}" dir="${3:-}"
    [[ -n "$environment" && -n "$generation" && -n "$dir" ]] || fail "Usage: scripts/backup/bucket.sh state <environment> <YYYY-MM> <state-dir>"
    for name in BACKUP_AGE_RECIPIENT BACKUP_INDEX_KEY; do
      [[ -n "${!name:-}" ]] || fail "Missing ${name}."
    done
    mkdir -p "$dir"
    current=$(lib 'console.log(lib.blobPrefix(process.argv[1], process.argv[2], lib.recipientTag(lib.parseRecipients(process.env.BACKUP_AGE_RECIPIENT))))' "$environment" "$generation") \
      || fail "BACKUP_AGE_RECIPIENT is not a list of age public keys, or ${environment} / ${generation} is not an environment and a YYYY-MM month."
    list "$current" > "$dir/blobs-current.txt" || fail "Cannot list the backup bucket. Check BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_REGION and the access key."
    list "${environment}/" | cut -f1 > "$private/keys.txt" || fail "Cannot list the backup bucket. Check BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_REGION and the access key."
    rm -f "$dir/previous-index.json" "$dir/carried.txt" "$dir/ignored-indexes.txt"
    : > "$dir/carried.txt"
    : > "$dir/ignored-indexes.txt"
    # The index keys of the last 40 days, newest first, none dated more than
    # an hour ahead (those are listed as ignored).
    # shellcheck disable=SC2016 # JavaScript, not shell, expands ${…} here.
    future=$(lib '
      const fs = await import("node:fs");
      const [keysFile, environment, candidatesFile, ignoredFile] = process.argv.slice(1);
      const keys = fs.readFileSync(keysFile, "utf8").split("\n");
      const found = lib.indexCandidates(keys, environment);
      const later = Date.now() + 3600_000;
      const ahead = keys.filter((k) => (lib.indexKeyTime(k, environment)?.getTime() ?? 0) > later);
      fs.writeFileSync(candidatesFile, found.keys.map((k) => `${k}\n`).join(""));
      fs.appendFileSync(ignoredFile, ahead.map((k) => `${k} dated more than an hour ahead\n`).join(""));
      console.log(found.future);
    ' "$private/keys.txt" "$environment" "$private/candidates.txt" "$dir/ignored-indexes.txt") \
      || fail "Cannot read the bucket's list of backups."
    # The newest whose signature verifies; the ones before it are counted.
    newest="" untrusted=0
    while read -r key; do
      s3 s3 cp "s3://${BUCKET}/${key}" "$private/candidate.json" --only-show-errors > /dev/null \
        || fail "Cannot download the index ${key} from the backup bucket."
      verdict=$(lib '
        const fs = await import("node:fs");
        let parsed;
        try { parsed = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { parsed = { unreadable: true }; }
        console.log(lib.readPreviousIndex(parsed, process.argv[2], lib.parseIndexKey(process.env.BACKUP_INDEX_KEY), process.argv[3]).reason ?? "trusted");
      ' "$private/candidate.json" "$environment" "$key") \
        || fail "BACKUP_INDEX_KEY is not usable (the line above says why). Make one with: openssl rand -base64 32"
      if [[ "$verdict" == trusted ]]; then
        mv "$private/candidate.json" "$dir/previous-index.json"
        newest="$key"
        break
      fi
      untrusted=$(( untrusted + 1 ))
      echo "${key} ${verdict}" >> "$dir/ignored-indexes.txt"
    done < "$private/candidates.txt"
    if (( untrusted > 0 || future > 0 )); then
      parts=()
      (( untrusted > 0 )) && parts+=("${untrusted} backup index(es) ${newest:+newer than the one used }failed their signature or format check, or recorded another run than their key names")
      (( future > 0 )) && parts+=("${future} dated more than an hour ahead")
      joined=$(printf '%s; ' "${parts[@]}")
      echo "::warning::${joined%; } were ignored. They were signed with another BACKUP_INDEX_KEY, or put there (or an older index copied there) by someone holding the bucket key; their keys are in the state folder's ignored-indexes.txt (runbook, \"Objects the backup did not make\")."
    fi
    # What to bring from the folder the trusted index recorded (only for the
    # same keys and an earlier month).
    # shellcheck disable=SC2016 # JavaScript, not shell, expands ${…} here.
    lib '
      const fs = await import("node:fs");
      const [indexFile, listingFile, environment, generation, prefix, planFile, indexKey] = process.argv.slice(1);
      const parsed = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : null;
      const previous = lib.readPreviousIndex(parsed, environment, lib.parseIndexKey(process.env.BACKUP_INDEX_KEY), indexKey || undefined);
      const tag = lib.parseBlobPrefix(prefix).tag;
      const listing = lib.parseBlobListing(fs.readFileSync(listingFile, "utf8"), prefix);
      const plan = lib.carryPlan(previous, { prefix, generation, tag, listing });
      fs.writeFileSync(planFile, plan.carry.map((b) => `${b.sha256} ${b.encSize} ${b.encSha256} ${b.from} ${b.to} ${b.check.join(",") || "-"}\n`).join(""));
      console.log(JSON.stringify({ from: plan.from, unverifiable: plan.unverifiable }));
    ' "$dir/previous-index.json" "$dir/blobs-current.txt" "$environment" "$generation" "$current" "$private/carry-plan.txt" "$newest" > "$private/carry.json" \
      || fail "Cannot plan the monthly copy (the line above says why)."
    from=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).from ?? "")' "$private/carry.json")
    unverifiable=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).unverifiable)' "$private/carry.json")
    if [[ -n "$from" && -s "$private/carry-plan.txt" ]]; then
      export FROM="$from" CURRENT="$current"
      xargs -P 4 -L 1 bash -c "$carry_one" _ < "$private/carry-plan.txt" > "$private/carry-results.txt" \
        || fail "Copying blobs from ${from} stopped unexpectedly."
      awk '$1 == "carried" { print $2, $3 }' "$private/carry-results.txt" | sort > "$dir/carried.txt"
      carried=$(wc -l < "$dir/carried.txt" | tr -d ' ')
      checked=$(awk '$1 == "carried" && $4 == "checked"' "$private/carry-results.txt" | wc -l | tr -d ' ')
      occupied=$(awk '$1 == "occupied"' "$private/carry-results.txt" | wc -l | tr -d ' ')
      rejected=$(awk '$1 == "rejected"' "$private/carry-results.txt" | wc -l | tr -d ' ')
      failed=$(awk '$1 == "failed"' "$private/carry-results.txt" | wc -l | tr -d ' ')
      echo "Carried ${carried} blob(s) from ${from} into ${current} (${checked} already there from an earlier attempt), each checked against its recorded size and sha256."
      if (( occupied > 0 )); then
        echo "::warning::${occupied} blob name(s) in ${current} hold an object that does not match the record of the blob it is named after (left by a run that failed, or put there by someone holding the bucket key); those blobs were copied under another name (<sha256>.<n>.age). Nothing is lost; see the runbook, \"Objects the backup did not make\"."
      fi
      if (( rejected > 0 )); then
        echo "::warning::${rejected} blob(s) in ${from} do not have the size or sha256 recorded when they were stored, so they were not copied; their files are downloaded again from Supabase tonight."
      fi
      if (( failed > 0 )); then
        echo "::warning::${failed} blob(s) could not be copied from ${from} (a download or upload failed); their files are downloaded again from Supabase tonight."
      fi
      # Re-list: what is in this month's folder now.
      list "$current" > "$dir/blobs-current.txt" || fail "Cannot list the backup bucket after copying."
    fi
    if (( unverifiable > 0 )); then
      echo "Note: ${unverifiable} blob(s) in ${from} have no recorded sha256, so they are not copied; their files are downloaded again from Supabase tonight."
    fi
    echo "Bucket: $(wc -l < "$dir/blobs-current.txt" | tr -d ' ') blob(s) in ${current}; previous index: ${newest:-none trusted (every file will be downloaded)}."
    ;;

  push)
    out="${1:-}" environment="${2:-}"
    [[ -d "$out" && -f "$out/backup.env" && -n "$environment" ]] || fail "Usage: scripts/backup/bucket.sh push <out-dir> <environment>"
    # shellcheck disable=SC1091
    source "$out/backup.env"
    current="$BACKUP_BLOB_PREFIX"
    lib 'if (!lib.parseBlobPrefix(process.argv[1])) process.exit(1)' "$current" || fail "backup.env's BACKUP_BLOB_PREFIX is not a blob folder."
    started=$SECONDS

    # 1. New blobs, each uploaded from its complete local file.
    uploaded=0
    blobs_ok=1
    if compgen -G "$out/blobs/*.age" > /dev/null; then
      if s3 s3 cp "$out/blobs/" "s3://${BUCKET}/${current}" --recursive --only-show-errors --no-progress \
        --content-type application/octet-stream; then
        uploaded=$(find "$out/blobs" -name '*.age' | wc -l | tr -d ' ')
      else
        echo "::error::Uploading new blobs to ${current} failed. Check the access key's permission to write to the bucket."
        blobs_ok=0
      fi
    fi

    # 2. Every blob the archive needs, in this month's folder, at the
    #    encrypted size recorded when it was first stored.
    if (( blobs_ok == 1 )); then
      list "$current" > "$private/blobs-after.txt" || fail "Cannot list ${current} after the upload."
      # shellcheck disable=SC2016 # JavaScript, not shell, expands ${…} here.
      # Counts only in the log (it is public); the names, which carry the
      # files' sha256s, go to a file on this machine.
      lib '
        const fs = await import("node:fs");
        const [indexFile, listing, prefix, detailsFile] = process.argv.slice(1);
        const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
        const result = lib.checkBlobListing(index.blobs, lib.parseBlobListing(fs.readFileSync(listing, "utf8"), prefix));
        console.log(`Blobs: ${index.blobs.length} needed by this backup, ${result.missing.length} missing, ${result.wrong.length} with the wrong size.`);
        const details = [
          ...result.missing.map((name) => `missing: ${name}`),
          ...result.wrong.map((w) => `wrong size: ${w.name} (${w.actual} bytes, expected ${w.expected})`),
        ];
        if (details.length > 0) fs.writeFileSync(detailsFile, `${details.join("\n")}\n`, { mode: 0o600 });
        if (result.missing.length > 0) {
          console.log(`::error::${result.missing.length} blob(s) this backup needs are not in ${prefix}. Their names are in ${detailsFile}, on the machine that ran this.`);
        }
        if (result.wrong.length > 0) {
          console.log(`::error::${result.wrong.length} blob(s) in ${prefix} do not have the encrypted size recorded when they were stored (damaged copies). The next run stores those files again under another name; nothing needs deleting. Their names are in ${detailsFile}, on the machine that ran this.`);
        }
        process.exit(result.ok ? 0 : 1);
      ' "$BACKUP_INDEX_FILE" "$private/blobs-after.txt" "$current" "$out/blob-check.txt" || blobs_ok=0
    fi
    echo "Blobs: ${uploaded} new uploaded into ${current}."

    # 3. The archive, then its index last: an index in the bucket means
    #    everything it lists is there. When the blobs failed, the archive
    #    (the database) is still kept, without an index.
    stamp=$(basename "$BACKUP_FILE" | sed -E 's/^qbbe-[a-z]+-([0-9]{4})([0-9]{2})([0-9]{2})T.*/\1-\2-\3/')
    key="${environment}/${stamp}/$(basename "$BACKUP_FILE")"
    put_checked "$BACKUP_FILE" "$key"
    echo "BACKUP_KEY=${key}" > "$out/upload.env"
    if (( blobs_ok == 0 )); then
      fail "The archive (database and manifest) is stored as ${key}, but not its index, because the file blobs above are not all in ${current}. The run is failed; a restore of this night needs ALLOW_MISSING_FILES=1."
    fi
    put_checked "$BACKUP_INDEX_FILE" "${environment}/${stamp}/$(basename "$BACKUP_INDEX_FILE")"
    echo "Off-site upload done in $(( SECONDS - started ))s."
    ;;

  fetch)
    environment="${1:-}" which="${2:-}" dest="${3:-}"
    [[ -n "$environment" && -n "$which" && -n "$dest" ]] \
      || fail "Usage: scripts/backup/bucket.sh fetch <environment> <latest|YYYY-MM-DD|YYYYMMDDTHHMMSSZ|archive name|key> <dest-dir>"
    if [[ -e "$dest" ]] && [[ -n "$(ls -A "$dest" 2> /dev/null)" ]]; then
      fail "${dest} is not empty. Fetch into a new folder."
    fi
    # shellcheck disable=SC2016 # JavaScript, not shell, expands ${…} here.
    target=$(lib 'const t = lib.parseFetchWhich(process.argv[1], process.argv[2]); console.log(`${t.prefix}\t${t.key ?? ""}`)' "$which" "$environment") \
      || fail "Cannot tell which backup to fetch (see the message above)."
    prefix=$(cut -f1 <<< "$target")
    wanted=$(cut -f2 <<< "$target")
    list "$prefix" | cut -f1 > "$private/keys.txt" || fail "Cannot list the backup bucket. Check BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_REGION and the access key."
    run_time() { sed -E 's#^.*/qbbe-[a-z-]+-([0-9]{8}T[0-9]{6}Z)\.index\.json$#\1#' <<< "$1"; }
    if [[ -n "$wanted" ]]; then
      grep -qxF "$wanted" "$private/keys.txt" || fail "No backup ${wanted} in the bucket."
      printf '%s\n' "$wanted" > "$private/candidates.txt"
    else
      # Well-formed index keys, newest first, none dated more than an hour
      # ahead (a planted name sorting last). The index's signature cannot be
      # checked here (custodians do not hold BACKUP_INDEX_KEY), so the runs
      # are listed with their archive's sha256: EXPECTED_SHA256 decides.
      # shellcheck disable=SC2016 # JavaScript, not shell, expands ${…} here.
      future=$(lib '
        const fs = await import("node:fs");
        const found = lib.indexCandidates(fs.readFileSync(process.argv[1], "utf8").split("\n"), process.argv[2], new Date(), { days: null });
        fs.writeFileSync(process.argv[3], found.keys.map((k) => `${k}\n`).join(""));
        console.log(found.future);
      ' "$private/keys.txt" "$environment" "$private/candidates.txt") || fail "Cannot read the bucket's list of backups."
      [[ -s "$private/candidates.txt" ]] \
        || fail "No backup of ${environment} under ${prefix} in the bucket$( (( future > 0 )) && echo " (${future} dated more than an hour ahead were ignored)")."
      total=$(wc -l < "$private/candidates.txt" | tr -d ' ')
      echo "Runs of ${environment} considered for ${which}, newest first: ${total}$( (( future > 0 )) && echo "; ${future} dated more than an hour ahead were ignored")."
      head -n 10 "$private/candidates.txt" | while read -r key; do
        label="not a valid backup index"
        if s3 s3api get-object --bucket "$BUCKET" --key "$key" --range bytes=0-4095 "$private/head.json" > /dev/null 2>&1; then
          # shellcheck disable=SC2016 # JavaScript, not shell, expands ${…} here.
          label=$(node -e '
            const text = require("fs").readFileSync(process.argv[1], "utf8");
            const sha = /^\{"format":"qbbe-backup-index\/2",[^]*?"archiveSha256":"([0-9a-f]{64})"/.exec(text)?.[1];
            console.log(sha ? `archive sha256 ${sha}` : "not a valid backup index");
          ' "$private/head.json")
        fi
        echo "  $(run_time "$key")  ${label}"
      done
      if (( total > 10 )); then echo "  (and $(( total - 10 )) older)"; fi
    fi
    mkdir -p "$dest/blobs"
    chmod 700 "$dest" "$dest/blobs"
    # A download that does not finish leaves no file behind.
    trap 'find "$dest" -name "*.part" -type f -delete 2> /dev/null; cleanup' EXIT
    list "blobs/${environment}/" > "$private/blob-listing.txt" || fail "Cannot list the blob folders of ${environment}."
    # The newest considered run whose index is a valid backup index. Every
    # value of the index that becomes part of a path is checked first.
    index_key=""
    while read -r key; do
      s3 s3 cp "s3://${BUCKET}/${key}" "$private/index.json" --only-show-errors > /dev/null || fail "Cannot download ${key}."
      # shellcheck disable=SC2016 # JavaScript, not shell, expands ${…} here.
      if lib '
        const fs = await import("node:fs");
        const [indexFile, environment, indexKey, listingFile, infoFile, planFile] = process.argv.slice(1);
        const checked = lib.checkFetchIndex(JSON.parse(fs.readFileSync(indexFile, "utf8")), environment, indexKey);
        const folders = lib.parseBlobFolders(fs.readFileSync(listingFile, "utf8"), environment, checked.tag);
        const plan = lib.fetchPlan(checked.blobs, checked.blobPrefix, folders);
        fs.writeFileSync(infoFile, [checked.archive, checked.archiveSha256, checked.blobPrefix].join("\n") + "\n");
        fs.writeFileSync(planFile, plan.map((p) => `${p.sha256} ${p.candidates.map((c) => [c.key, c.size ?? "-", c.sha256 ?? "-", c.local, c.kind].join("|")).join(";")}\n`).join(""));
      ' "$private/index.json" "$environment" "$key" "$private/blob-listing.txt" "$private/index.txt" "$private/blobs.txt"; then
        # A valid index whose archive is not in the bucket (a run that
        # stopped between the two uploads, or an archive deleted since):
        # try the next run.
        read -r archive < "$private/index.txt"
        if grep -qxF "$(dirname "$key")/${archive}" "$private/keys.txt"; then
          index_key="$key"
          break
        fi
        echo "Skipping $(run_time "$key"): its index is valid, but its archive ${archive} is not in the bucket."
        continue
      fi
      echo "Skipping $(run_time "$key"): not a valid backup index (the line above says why)."
    done < "$private/candidates.txt"
    [[ -n "$index_key" ]] || fail "No run among those considered has both a valid backup index and its archive in the bucket (the lines above say why); nothing was fetched. Fetch one run by its time from the Backup run's summary instead."
    echo "Fetching $(run_time "$index_key")."
    index="$dest/$(basename "$index_key")"
    mv "$private/index.json" "$index"
    { read -r archive; read -r expected; } < "$private/index.txt"
    s3 s3 cp "s3://${BUCKET}/$(dirname "$index_key")/${archive}" "$dest/${archive}.part" --only-show-errors --no-progress > /dev/null \
      || fail "Cannot download ${archive}."
    mv "$dest/${archive}.part" "$dest/${archive}"
    export DEST="$dest"
    xargs -P 8 -L 1 bash -c "$fetch_one" _ < "$private/blobs.txt" > "$private/fetched.txt" || fail "Fetching the blobs stopped unexpectedly."
    find "$dest" -type f -exec chmod 600 {} +
    count=$(awk '$1 == "primary" || $1 == "copy"' "$private/fetched.txt" | wc -l | tr -d ' ')
    copies=$(awk '$1 == "copy"' "$private/fetched.txt" | wc -l | tr -d ' ')
    unchecked=$(awk '$1 == "unchecked"' "$private/fetched.txt" | wc -l | tr -d ' ')
    missing=$(awk '$1 == "missing" { print $2 }' "$private/fetched.txt")
    sha=$(sha256_of "$dest/${archive}")
    [[ "$sha" == "$expected" ]] || fail "The downloaded archive's sha256 (${sha}) is not the one its index records (${expected}). Do not restore it."
    echo "Fetched ${dest}/${archive} and ${count} blob(s) into ${dest}/blobs, each with its recorded size and sha256$( (( copies > 0 )) && echo " (${copies} from an identical copy in another month folder of the same keys)")."
    if (( unchecked > 0 )); then
      echo "${unchecked} blob(s) have no recorded encrypted sha256 that any copy matched (an index without one, or every checkable copy damaged): every copy found was fetched, and unpack-blobs keeps the one that decrypts to the file's own sha256."
    fi
    echo "Archive sha256: ${sha}"
    echo "Compare it with the sha256 in the summary of the Backup run that made it (GitHub, Actions, Backup), or in the outside monitor's log of that night's check-in. They must be the same; restore-drill.sh takes it as EXPECTED_SHA256."
    if [[ -n "$missing" ]]; then
      printf '%s\n' "$missing" > "$dest/blobs-missing.txt"
      fail "$(wc -l < "$dest/blobs-missing.txt" | tr -d ' ') blob(s) were found in no month folder of these keys (listed by content hash in ${dest}/blobs-missing.txt). Restore the database and the other files with ALLOW_MISSING_FILES=1, or try another night (runbook, Restore)."
    fi
    ;;

  *)
    fail "Usage: scripts/backup/bucket.sh <state|push|fetch> …"
    ;;
esac
