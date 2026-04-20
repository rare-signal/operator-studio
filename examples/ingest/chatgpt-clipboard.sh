#!/usr/bin/env bash
# Ingest whatever is on your clipboard.
#
# Useful after:
#   - copying a ChatGPT conversation (the labeled-transcript parser handles
#     the "You said / ChatGPT said" shape directly)
#   - copying a Claude conversation from claude.ai
#   - exporting a ChatGPT share page (paste the JSON blob — the parser
#     recognizes the `mapping` shape)
#
# Usage:
#     ./chatgpt-clipboard.sh
#     ./chatgpt-clipboard.sh --title "auth rewrite discussion"
set -euo pipefail

title=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --title) title="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

if command -v pbpaste >/dev/null 2>&1; then
  read_clipboard() { pbpaste; }
elif command -v xclip >/dev/null 2>&1; then
  read_clipboard() { xclip -selection clipboard -o; }
elif command -v xsel >/dev/null 2>&1; then
  read_clipboard() { xsel -b; }
else
  echo "no clipboard reader found (pbpaste/xclip/xsel)" >&2
  exit 1
fi

body="$(read_clipboard)"
if [[ -z "${body// }" ]]; then
  echo "clipboard is empty" >&2; exit 1
fi

url="${OPERATOR_STUDIO_URL:-http://localhost:4200}/api/operator-studio/ingest"
qs="source=manual"
[[ -n "$title" ]] && qs+="&title=$(printf '%s' "$title" | jq -sRr @uri 2>/dev/null || printf '%s' "$title")"

# Sniff content-type.
first="$(printf '%s' "$body" | tr -d '[:space:]' | head -c 1)"
if [[ "$first" == "{" || "$first" == "[" ]]; then
  ct="application/json"
else
  ct="text/plain"
fi

auth=()
[[ -n "${OPERATOR_STUDIO_INGEST_TOKEN:-}" ]] && \
  auth=(-H "Authorization: Bearer $OPERATOR_STUDIO_INGEST_TOKEN")

curl -sS -X POST "$url?$qs" \
  "${auth[@]}" \
  -H "Content-Type: $ct" \
  --data-binary "$body"
echo
