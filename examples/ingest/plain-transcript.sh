#!/usr/bin/env bash
# Ingest a plain-text conversation file.
#
# Supported shapes (autodetected):
#   User: hey, why is the sidebar layout not re-rendering?
#
#   Assistant: Because the parent layout is still resolving the cached
#   fetch. Try revalidatePath() from the server action...
#
# or markdown with headings (# User / # Assistant / etc), or JSON/JSONL.
#
# Usage:
#     ./plain-transcript.sh path/to/transcript.txt
#     ./plain-transcript.sh path/to/transcript.txt --title "my-session" --tags "nextjs,app-router"
set -euo pipefail

file="${1:?path to transcript required}"
shift

title=""; tags=""; project=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --title) title="$2"; shift 2 ;;
    --tags) tags="$2"; shift 2 ;;
    --project) project="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

[[ -r "$file" ]] || { echo "cannot read $file" >&2; exit 1; }

url="${OPERATOR_STUDIO_URL:-http://localhost:4200}/api/operator-studio/ingest"
qs="source=manual"
_enc() { printf '%s' "$1" | jq -sRr @uri 2>/dev/null || printf '%s' "$1"; }
[[ -n "$title" ]]   && qs+="&title=$(_enc "$title")"
[[ -n "$tags" ]]    && qs+="&tags=$(_enc "$tags")"
[[ -n "$project" ]] && qs+="&projectSlug=$(_enc "$project")"

auth=()
[[ -n "${OPERATOR_STUDIO_INGEST_TOKEN:-}" ]] && \
  auth=(-H "Authorization: Bearer $OPERATOR_STUDIO_INGEST_TOKEN")

curl -sS -X POST "$url?$qs" \
  "${auth[@]}" \
  -H "Content-Type: text/plain" \
  --data-binary "@$file"
echo
