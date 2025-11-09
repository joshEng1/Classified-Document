#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <pdf_path>" >&2
  exit 1
fi

PDF="$1"
HOST="${HOST:-http://localhost:5055}"

if [ ! -f "$PDF" ]; then
  echo "File not found: $PDF" >&2
  exit 2
fi

echo "-> Hitting $HOST/health"
curl -s "$HOST/health" | jq . || true

echo "-> Posting $PDF to /api/process"
RESP=$(curl -s -F "file=@$PDF" "$HOST/api/process")
echo "$RESP" | jq '{final, local: .local, routed: .routed, route_reason: .route_reason, guards: .guards}' || echo "$RESP"

