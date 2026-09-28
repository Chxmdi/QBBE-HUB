#!/usr/bin/env bash
# Creates supabase/signing_keys.json for the LOCAL stack if it is missing: one
# ES256 key, so local Auth signs sessions asymmetrically, as the hosted
# projects do once switched (#138). The file holds a private key and is
# gitignored; it is only ever used by the local containers. Idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."
file=supabase/signing_keys.json
if [[ -s "$file" ]]; then
  echo "Local signing key already present ($file)."
  exit 0
fi
# Generated outside the project: the CLI reads supabase/config.toml first,
# and that already names the file this script is about to create.
# Prefers the CLI on PATH (CI installs one with supabase/setup-cli).
root=$(pwd)
if command -v supabase >/dev/null 2>&1; then cli=(supabase); else cli=(npx --yes --prefix "$root" supabase); fi
key=$(cd "$(mktemp -d)" && "${cli[@]}" gen signing-key --algorithm ES256 2>/dev/null)
node -e 'const k=JSON.parse(process.argv[1]); require("fs").writeFileSync(process.argv[2], JSON.stringify(Array.isArray(k)?k:[k], null, 2)+"\n", {mode: 0o600});' "$key" "$file"
echo "Created $file (ES256, local only)."
