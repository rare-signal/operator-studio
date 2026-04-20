#!/usr/bin/env bash
# Minimal webhook handler pattern. Drop this into a GitHub Action,
# Slack slash-command handler, or any other HTTP-triggered context —
# it reads the incoming body and forwards it to Operator Studio.
#
# Example: GitHub Action step
#
#   - name: Capture Claude review to Operator Studio
#     env:
#       OPERATOR_STUDIO_URL: https://studio.internal
#       OPERATOR_STUDIO_INGEST_TOKEN: ${{ secrets.OPERATOR_STUDIO_INGEST_TOKEN }}
#     run: |
#       cat review.json | ./examples/ingest/webhook.sh \
#         --title "PR #${{ github.event.pull_request.number }} review" \
#         --tags "ci,pr-review" \
#         --project "${{ github.event.repository.name }}"
set -euo pipefail

title=""; tags=""; project=""; source="manual"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --title) title="$2"; shift 2 ;;
    --tags) tags="$2"; shift 2 ;;
    --project) project="$2"; shift 2 ;;
    --source) source="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

body="$(cat)"
[[ -n "${body// }" ]] || { echo "empty stdin" >&2; exit 1; }

first="$(printf '%s' "$body" | tr -d '[:space:]' | head -c 1)"
ct="text/plain"
[[ "$first" == "{" || "$first" == "[" ]] && ct="application/json"

url="${OPERATOR_STUDIO_URL:?OPERATOR_STUDIO_URL required}/api/operator-studio/ingest"
qs="source=$source"
_enc() { printf '%s' "$1" | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read(),safe=""),end="")' 2>/dev/null || printf '%s' "$1"; }
[[ -n "$title" ]]   && qs+="&title=$(_enc "$title")"
[[ -n "$tags" ]]    && qs+="&tags=$(_enc "$tags")"
[[ -n "$project" ]] && qs+="&projectSlug=$(_enc "$project")"

auth=()
[[ -n "${OPERATOR_STUDIO_INGEST_TOKEN:-}" ]] && \
  auth=(-H "Authorization: Bearer $OPERATOR_STUDIO_INGEST_TOKEN")

curl -sS -X POST "$url?$qs" \
  "${auth[@]}" \
  -H "Content-Type: $ct" \
  --data-binary "$body"
echo
