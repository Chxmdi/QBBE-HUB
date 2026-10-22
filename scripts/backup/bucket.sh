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
#        newest index. On the first night of a month (or after a gap), it
#        copies the blobs the previous index recorded into this month's
#        folder: each one through a private temporary file, checked against
#        the encrypted size and sha256 recorded when it was first stored,
#        then uploaded from that file. A blob that fails the check is not
#        copied; its file is downloaded again from Supabase instead. Needs
#        BACKUP_AGE_RECIPIENT (the folder is named after the keys) and
#        BACKUP_INDEX_KEY (an index with a bad signature is not used).
# push   after create-backup.sh: uploads the new blobs, checks that every
#        blob the archive needs is in this month's folder at the encrypted
#        size its index records, then uploads the archive and its index and
#        reads each one back in full: the downloaded bytes must have the
#        local file's sha256. If the blobs fail, the archive (the database)
#        is still uploaded, without its index, and the run fails.
# fetch  for a restore: downloads one backup's archive, its index and every
#        blob it needs into a new <dest-dir>, and prints the archive's sha256
#        to compare with the Backup run's summary. <which> is `latest`, a
#        date (YYYY-MM-DD: the newest run of that day; the others are
#        listed), or one run: its time (YYYYMMDDTHHMMSSZ), its archive name
#        or its key from the Backup run's summary. Needs no index key.
#
# Layout in the bucket:
#   <environment>/<YYYY-MM-DD>/qbbe-<environment>-<time>.tar.gz.age   archive
#   <environment>/<YYYY-MM-DD>/qbbe-<environment>-<time>.index.json   its index
#   blobs/<environment>/<YYYY-MM>-<tag>/<sha256>.age                  one per file
# <tag> names the custodians' keys the blobs are encrypted to
# (lib.mjs recipientTag): a change of keys starts new folders. The lifecycle
# rules (runbook, setup step 4) delete archives after 35 days and blob
# folders after 70, so every kept archive still finds its blobs.
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

# One blob from one folder to another through a private temporary file:
# downloaded in full, checked against its recorded encrypted size and
# sha256, then uploaded from the file. Prints "carried", "rejected" or
# "failed" and the sha256; never a file name (blobs are named by content).
# shellcheck disable=SC2016 # expanded by the inner bash
carry_one='
  sha="$1" size="$2" want="$3"
  tmp=$(mktemp "${PRIVATE}/carry.XXXXXX") || { echo "failed $sha"; exit 0; }
  trap "rm -f \"$tmp\"" EXIT
  if ! s3 s3 cp "s3://${BUCKET}/${FROM}${sha}.age" "$tmp" --only-show-errors --no-progress > /dev/null 2>&1; then
    echo "failed $sha"; exit 0
  fi
  if [[ "$(size_of "$tmp")" != "$size" || "$(sha256_of "$tmp")" != "$want" ]]; then
    echo "rejected $sha"; exit 0
  fi
  if s3 s3 cp "$tmp" "s3://${BUCKET}/${CURRENT}${sha}.age" --only-show-errors --no-progress --content-type application/octet-stream > /dev/null 2>&1; then
    echo "carried $sha"
  else
    echo "failed $sha"
  fi
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
    list "${environment}/" | cut -f1 > "$private/keys.txt"
    newest=$(lib 'const fs = await import("node:fs"); console.log(lib.newestIndexKey(fs.readFileSync(process.argv[1], "utf8").split("\n"), process.argv[2]) ?? "")' "$private/keys.txt" "$environment")
    rm -f "$dir/previous-index.json" "$dir/carried.txt"
    : > "$dir/carried.txt"
    if [[ -n "$newest" ]]; then
      s3 s3 cp "s3://${BUCKET}/${newest}" "$dir/previous-index.json" --only-show-errors > /dev/null \
        || fail "Cannot download the previous index ${newest}."
    fi
    # What to copy from the folder the previous index recorded (only when it
    # verifies, is for the same keys and an earlier month).
    # shellcheck disable=SC2016 # JavaScript, not shell, expands ${…} here.
    lib '
      const fs = await import("node:fs");
      const [indexFile, listingFile, environment, generation, prefix, planFile] = process.argv.slice(1);
      let parsed = null;
      try { parsed = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : null; } catch { parsed = { unreadable: true }; }
      const previous = lib.readPreviousIndex(parsed, environment, lib.parseIndexKey(process.env.BACKUP_INDEX_KEY));
      const tag = lib.parseBlobPrefix(prefix).tag;
      const listing = lib.parseBlobListing(fs.readFileSync(listingFile, "utf8"), prefix);
      const plan = lib.carryPlan(previous, { prefix, generation, tag, listing });
      fs.writeFileSync(planFile, plan.carry.map((b) => `${b.sha256} ${b.encSize} ${b.encSha256}\n`).join(""));
      console.log(JSON.stringify({ reason: previous.reason, from: plan.from, unverifiable: plan.unverifiable }));
    ' "$dir/previous-index.json" "$dir/blobs-current.txt" "$environment" "$generation" "$current" "$private/carry-plan.txt" > "$private/carry.json" \
      || fail "BACKUP_INDEX_KEY is not usable (it must hold at least 32 random bytes, as hex or base64)."
    reason=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).reason ?? "")' "$private/carry.json")
    from=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).from ?? "")' "$private/carry.json")
    unverifiable=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).unverifiable)' "$private/carry.json")
    if [[ "$reason" == signature ]]; then
      echo "::warning::The previous index (${newest}) failed its signature check (BACKUP_INDEX_KEY), so it is not used: nothing is copied from last month and every file is downloaded again tonight."
    fi
    if [[ -n "$from" && -s "$private/carry-plan.txt" ]]; then
      export FROM="$from" CURRENT="$current"
      xargs -P 4 -L 1 bash -c "$carry_one" _ < "$private/carry-plan.txt" > "$private/carry-results.txt" \
        || fail "Copying blobs from ${from} stopped unexpectedly."
      awk '$1 == "carried" { print $2 }' "$private/carry-results.txt" | sort > "$dir/carried.txt"
      carried=$(wc -l < "$dir/carried.txt" | tr -d ' ')
      rejected=$(awk '$1 == "rejected"' "$private/carry-results.txt" | wc -l | tr -d ' ')
      failed=$(awk '$1 == "failed"' "$private/carry-results.txt" | wc -l | tr -d ' ')
      echo "Carried ${carried} blob(s) from ${from} into ${current}, each checked against its recorded size and sha256."
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
    echo "Bucket: $(wc -l < "$dir/blobs-current.txt" | tr -d ' ') blob(s) in ${current}; previous index: ${newest:-none (every file will be downloaded)}${reason:+ (not used: ${reason})}."
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
      lib '
        const fs = await import("node:fs");
        const [indexFile, listing, prefix] = process.argv.slice(1);
        const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
        const result = lib.checkBlobListing(index.blobs, lib.parseBlobListing(fs.readFileSync(listing, "utf8"), prefix));
        console.log(`Blobs: ${index.blobs.length} needed by this backup, ${result.missing.length} missing, ${result.wrong.length} with the wrong size.`);
        if (result.missing.length > 0) {
          console.log(`::error::${result.missing.length} blob(s) this backup needs are not in ${prefix}. Their sha256s (content hashes, not file names): ${result.missing.join(" ")}`);
        }
        if (result.wrong.length > 0) {
          console.log(`::error::${result.wrong.length} blob(s) in ${prefix} do not have the encrypted size recorded when they were stored (damaged copies). The backup key cannot replace them: an administrator of the bucket must delete these objects in ${prefix}, then run Backup again, which stores them anew: ${result.wrong.map((w) => `${w.sha256}.age (${w.actual} bytes, expected ${w.expected})`).join(", ")}`);
        }
        process.exit(result.ok ? 0 : 1);
      ' "$BACKUP_INDEX_FILE" "$private/blobs-after.txt" "$current" || blobs_ok=0
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
    # Only well-formed index keys; a run named by its time must be there.
    # shellcheck disable=SC2016 # JavaScript, not shell, expands ${…} here.
    lib '
      const fs = await import("node:fs");
      const keys = fs.readFileSync(process.argv[1], "utf8").split("\n").filter((k) => lib.indexKeyTime(k, process.argv[2]) !== null).sort();
      fs.writeFileSync(process.argv[1], keys.map((k) => `${k}\n`).join(""));
    ' "$private/keys.txt" "$environment"
    if [[ -n "$wanted" ]]; then
      grep -qxF "$wanted" "$private/keys.txt" || fail "No backup ${wanted} in the bucket."
      index_key="$wanted"
    else
      index_key=$(tail -n 1 "$private/keys.txt")
      [[ -n "$index_key" ]] || fail "No backup of ${environment} under ${prefix} in the bucket."
      if [[ "$prefix" != "${environment}/" ]] && (( $(wc -l < "$private/keys.txt") > 1 )); then
        echo "That day has $(wc -l < "$private/keys.txt" | tr -d ' ') backup runs; fetching the newest. To fetch another, give its time instead of the date:"
        sed -E 's#^.*/qbbe-[a-z-]+-([0-9]{8}T[0-9]{6}Z)\.index\.json$#  \1#' "$private/keys.txt"
      fi
    fi
    mkdir -p "$dest/blobs"
    chmod 700 "$dest" "$dest/blobs"
    # A download that does not finish leaves no file behind.
    trap 'find "$dest" -name "*.part" -type f -delete 2> /dev/null; cleanup' EXIT
    index="$dest/$(basename "$index_key")"
    s3 s3 cp "s3://${BUCKET}/${index_key}" "${index}.part" --only-show-errors > /dev/null || fail "Cannot download ${index_key}."
    mv "${index}.part" "$index"
    # Every value of the index that becomes part of a path is checked first.
    # shellcheck disable=SC2016 # JavaScript, not shell, expands ${…} here.
    lib '
      const fs = await import("node:fs");
      const checked = lib.checkFetchIndex(JSON.parse(fs.readFileSync(process.argv[1], "utf8")), process.argv[2], process.argv[3]);
      const previous = lib.blobPrefix(process.argv[2], lib.previousGeneration(checked.generation), checked.tag);
      fs.writeFileSync(process.argv[4], [checked.archive, checked.archiveSha256, checked.blobPrefix, previous].join("\n") + "\n");
      fs.writeFileSync(process.argv[5], checked.blobs.map((b) => `${b.sha256} ${b.encSize} ${b.encSha256 ?? "-"}\n`).join(""));
    ' "$index" "$environment" "$index_key" "$private/index.txt" "$private/blobs.txt" \
      || { rm -f "$index"; fail "The index ${index_key} is not a valid backup index (the line above says why); nothing was fetched. Fetch one run by its time from the Backup run's summary instead."; }
    { read -r archive; read -r expected; read -r blob_prefix; read -r older_prefix; } < "$private/index.txt"
    s3 s3 cp "s3://${BUCKET}/$(dirname "$index_key")/${archive}" "$dest/${archive}.part" --only-show-errors --no-progress > /dev/null \
      || fail "Cannot download ${archive}."
    mv "$dest/${archive}.part" "$dest/${archive}"
    export BLOB_PREFIX="$blob_prefix" OLDER_PREFIX="$older_prefix" DEST="$dest"
    # Each blob: from its folder, checked against the encrypted size and
    # sha256 its index records; failing that, last month's copy (which the
    # restore checks by the file's own sha256 after decrypting).
    # shellcheck disable=SC2016 # expanded by the inner bash
    xargs -P 8 -L 1 bash -c '
      sha="$1" size="$2" want="$3" part="${DEST}/blobs/$1.age.part"
      if s3 s3 cp "s3://${BUCKET}/${BLOB_PREFIX}${sha}.age" "$part" --only-show-errors --no-progress > /dev/null 2>&1 \
        && [[ "$(size_of "$part")" == "$size" ]] && { [[ "$want" == "-" ]] || [[ "$(sha256_of "$part")" == "$want" ]]; }; then
        mv "$part" "${DEST}/blobs/${sha}.age"; echo "ok $sha"; exit 0
      fi
      rm -f "$part"
      if s3 s3 cp "s3://${BUCKET}/${OLDER_PREFIX}${sha}.age" "$part" --only-show-errors --no-progress > /dev/null 2>&1; then
        mv "$part" "${DEST}/blobs/${sha}.age"; echo "older $sha"; exit 0
      fi
      rm -f "$part"; echo "missing $sha"
    ' _ < "$private/blobs.txt" > "$private/fetched.txt" || fail "Fetching the blobs stopped unexpectedly."
    find "$dest" -type f -exec chmod 600 {} +
    count=$(awk '$1 == "ok" || $1 == "older"' "$private/fetched.txt" | wc -l | tr -d ' ')
    older=$(awk '$1 == "older"' "$private/fetched.txt" | wc -l | tr -d ' ')
    missing=$(awk '$1 == "missing" { print $2 }' "$private/fetched.txt")
    sha=$(sha256_of "$dest/${archive}")
    [[ "$sha" == "$expected" ]] || fail "The downloaded archive's sha256 (${sha}) is not the one its index records (${expected}). Do not restore it."
    echo "Fetched ${dest}/${archive} and ${count} blob(s) into ${dest}/blobs$( (( older > 0 )) && echo " (${older} from ${older_prefix}, checked when restored)")."
    echo "Archive sha256: ${sha}"
    echo "Compare it with the sha256 in the summary of the Backup run that made it (GitHub, Actions, Backup). They must be the same; restore-drill.sh takes it as EXPECTED_SHA256."
    if [[ -n "$missing" ]]; then
      printf '%s\n' "$missing" > "$dest/blobs-missing.txt"
      fail "$(wc -l < "$dest/blobs-missing.txt" | tr -d ' ') blob(s) could not be fetched, or did not have their recorded size and sha256 (listed by content hash in ${dest}/blobs-missing.txt). Try a backup from the month before, or restore the database and the other files with ALLOW_MISSING_FILES=1 (runbook, Restore)."
    fi
    ;;

  *)
    fail "Usage: scripts/backup/bucket.sh <state|push|fetch> …"
    ;;
esac
