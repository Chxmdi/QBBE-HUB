#!/bin/sh
# Live integration verification for Workstream 6.
# Exits 1 until QBBE-owned credentials are present. Does not send mail or
# publish data when variables are missing.

set -eu

missing=0
require() {
  eval "value=\${$1:-}"
  if [ -z "$value" ]; then
    echo "missing $1"
    missing=1
  fi
}

require NEXT_PUBLIC_SUPABASE_URL
require NEXT_PUBLIC_SUPABASE_ANON_KEY
require QBBE_SENDER_DOMAIN
require QBBE_GOOGLE_CLIENT_ID
require QBBE_VMS_BASE_URL
require QBBE_TEST_RECIPIENT

if [ "$missing" -ne 0 ]; then
  echo "Workstream 6 is blocked on QBBE credentials. Do not substitute personal accounts."
  exit 1
fi

echo "Credentials present. Run the dated live checks in docs/runbooks/integrations.md and record INT-* evidence."
