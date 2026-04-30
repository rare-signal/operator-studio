#!/usr/bin/env bash
# Pipe the Gemini CLI's structured JSON response into Operator Studio.
#
# Requires:  gemini CLI, curl
# Optional:  OPERATOR_STUDIO_INGEST_TOKEN
#
# Usage:
#     ./gemini.sh "explain how websockets differ from SSE"
#     ./gemini.sh --title "ws vs sse" "explain how websockets..."
set -euo pipefail

title=""
if [[ "${1:-}" == "--title" ]]; then
  title="$2"; shift 2
fi

prompt="${1:?prompt required}"

url="${OPERATOR_STUDIO_URL:-http://localhost:4200}/api/operator-studio/ingest"
qs="source=manual"
[[ -n "$title" ]] && qs+="&title=$(printf '%s' "$title" | jq -sRr @uri)"

auth=()
[[ -n "${OPERATOR_STUDIO_INGEST_TOKEN:-}" ]] && \
  auth=(-H "Authorization: Bearer $OPERATOR_STUDIO_INGEST_TOKEN")

# Gemini CLI emits a generateContent-shaped JSON response on stdout; we
# send it straight through. The universal parser recognizes `candidates`
# and pulls the top candidate's text. The prompt is wrapped in
# `request.contents` so the parser captures both sides of the turn.
gemini generate "$prompt" --format json 2>/dev/null | \
  jq --arg prompt "$prompt" '
    . + { request: { contents: [{ role: "user", parts: [{ text: $prompt }] }] } }
  ' | \
  curl -sS -X POST "$url?$qs" \
    "${auth[@]}" \
    -H "Content-Type: application/json" \
    --data-binary @-
echo
