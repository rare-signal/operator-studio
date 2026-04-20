#!/usr/bin/env bash
# opsctl — tiny CLI for Operator Studio ingestion.
#
# Source this file from your shell rc:
#     source /path/to/operator-studio/examples/ingest/opsctl.sh
#
# Then:
#     opsctl ingest < transcript.txt
#     pbpaste | opsctl ingest --title "brainstorm" --tags "routing,q4"
#     gemini generate "..." | opsctl ingest --source manual
#     opsctl open <threadId>
#
# Configure with:
#     export OPERATOR_STUDIO_URL=http://localhost:4200
#     export OPERATOR_STUDIO_INGEST_TOKEN=...   # optional in fully-open dev

opsctl() {
  local cmd="${1:-help}"; shift || true

  case "$cmd" in
    ingest) opsctl_ingest "$@" ;;
    open)   opsctl_open "$@" ;;
    help|-h|--help) opsctl_help ;;
    *) echo "opsctl: unknown command '$cmd'"; opsctl_help; return 1 ;;
  esac
}

opsctl_help() {
  cat <<'EOF'
opsctl ingest [--title T] [--tags a,b,c] [--project P] [--source S] [--workspace W] [--content-type CT] [--auto-tag]
  Reads stdin and POSTs to /api/operator-studio/ingest.
  Auto-detects JSON vs text by sniffing the first non-whitespace character
  (you can override with --content-type application/json or text/plain).
  Pass --auto-tag to append &autoTag=1 so the server runs the ingest
  through the LLM cluster and derives 2–5 topic tags when --tags is
  not provided. Silently falls back to no tags when the cluster is
  unreachable.

opsctl open <threadId>
  Open the thread in your browser.
EOF
}

opsctl_ingest() {
  local title tags project source workspace content_type
  local auto_tag=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --title) title="$2"; shift 2 ;;
      --tags) tags="$2"; shift 2 ;;
      --project) project="$2"; shift 2 ;;
      --source) source="$2"; shift 2 ;;
      --workspace) workspace="$2"; shift 2 ;;
      --content-type) content_type="$2"; shift 2 ;;
      --auto-tag) auto_tag="1"; shift 1 ;;
      *) echo "opsctl ingest: unknown flag '$1'"; return 1 ;;
    esac
  done

  local url="${OPERATOR_STUDIO_URL:-http://localhost:4200}/api/operator-studio/ingest"
  local qs=""
  [[ -n "$title"    ]] && qs+="&title=$(_opsctl_urlencode "$title")"
  [[ -n "$tags"     ]] && qs+="&tags=$(_opsctl_urlencode "$tags")"
  [[ -n "$project"  ]] && qs+="&projectSlug=$(_opsctl_urlencode "$project")"
  [[ -n "$source"   ]] && qs+="&source=$(_opsctl_urlencode "$source")"
  [[ -n "$workspace" ]] && qs+="&workspaceId=$(_opsctl_urlencode "$workspace")"
  [[ -n "$auto_tag" ]] && qs+="&autoTag=1"
  qs="${qs:1}"
  [[ -n "$qs" ]] && url="${url}?${qs}"

  # Slurp stdin.
  local body
  body="$(cat)"
  if [[ -z "$body" ]]; then
    echo "opsctl ingest: empty stdin" >&2; return 1
  fi

  # Sniff content-type unless overridden.
  if [[ -z "$content_type" ]]; then
    local first
    first="$(printf '%s' "$body" | tr -d '[:space:]' | head -c 1)"
    if [[ "$first" == "{" || "$first" == "[" ]]; then
      content_type="application/json"
    else
      content_type="text/plain"
    fi
  fi

  local auth=()
  if [[ -n "$OPERATOR_STUDIO_INGEST_TOKEN" ]]; then
    auth=(-H "Authorization: Bearer $OPERATOR_STUDIO_INGEST_TOKEN")
  fi

  curl -sS -X POST "$url" \
    "${auth[@]}" \
    -H "Content-Type: $content_type" \
    --data-binary "$body"
  echo
}

opsctl_open() {
  local id="${1:?thread id required}"
  local url="${OPERATOR_STUDIO_URL:-http://localhost:4200}/operator-studio/threads/$id"
  if command -v open >/dev/null 2>&1; then open "$url"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url"
  else echo "$url"
  fi
}

_opsctl_urlencode() {
  local raw="$1" out="" c i
  for (( i=0; i<${#raw}; i++ )); do
    c="${raw:$i:1}"
    case "$c" in
      [a-zA-Z0-9.~_-]) out+="$c" ;;
      *) out+="$(printf '%%%02X' "'$c")" ;;
    esac
  done
  printf '%s' "$out"
}
