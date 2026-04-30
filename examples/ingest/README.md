# Ingestion examples

Recipes for piping conversations from anywhere into Operator Studio. The
`POST /api/operator-studio/ingest` endpoint accepts JSON, plain-text
transcripts, markdown, or provider-native shapes (Gemini, OpenAI, Claude,
ChatGPT) and runs them through the universal parser — so most callers can
just pipe raw output.

## Setup

Set an ingest token in your environment so scripts and IDE hooks don't need
a cookie session:

```bash
# .env.local
OPERATOR_STUDIO_INGEST_TOKEN=$(openssl rand -hex 32)
```

Then export it for the scripts in this directory:

```bash
export OPERATOR_STUDIO_URL=http://localhost:4200
export OPERATOR_STUDIO_INGEST_TOKEN=...
```

(In fully-open local dev — no password, no token — the endpoint accepts
unauthenticated POSTs, so you can skip the token for a quick try.)

## What's here

| File | What it does |
|---|---|
| [`opsctl.sh`](./opsctl.sh) | Bash function. `opsctl ingest < file` or `pbpaste \| opsctl ingest --title "..."`. The swiss-army one — source it in `.zshrc`/`.bashrc`. |
| [`gemini.sh`](./gemini.sh) | Pipe the Gemini CLI's structured JSON response directly in. |
| [`chatgpt-clipboard.sh`](./chatgpt-clipboard.sh) | Send the current clipboard as-is (useful after copying a ChatGPT share page, Claude conversation, or anything else). |
| [`plain-transcript.sh`](./plain-transcript.sh) | Ingest a labeled text file like `User: ...\nAssistant: ...`. |
| [`webhook.sh`](./webhook.sh) | Minimal curl you can paste into a GitHub Action, Slack slash-command handler, or any webhook. |

## One-liner reference

```bash
# Plain transcript
curl -X POST "$OPERATOR_STUDIO_URL/api/operator-studio/ingest?title=my-debug-session&tags=debug,local" \
     -H "Authorization: Bearer $OPERATOR_STUDIO_INGEST_TOKEN" \
     -H "Content-Type: text/plain" \
     --data-binary @transcript.txt

# Gemini response JSON
gemini generate ... | curl -X POST "$OPERATOR_STUDIO_URL/api/operator-studio/ingest?source=manual" \
     -H "Authorization: Bearer $OPERATOR_STUDIO_INGEST_TOKEN" \
     -H "Content-Type: application/json" \
     --data-binary @-

# Whatever is on your clipboard
pbpaste | curl -X POST "$OPERATOR_STUDIO_URL/api/operator-studio/ingest" \
     -H "Authorization: Bearer $OPERATOR_STUDIO_INGEST_TOKEN" \
     -H "Content-Type: text/plain" \
     --data-binary @-
```

The response includes the created thread id and the format the parser
detected, e.g.:

```json
{
  "ok": true,
  "threadId": "thread-a1b2c3...",
  "workspaceId": "global",
  "detectedFormat": "gemini-generate",
  "messageCount": 3,
  "title": "fix sidebar layout bug",
  "notes": ["parsed 3 turn(s) from Gemini generateContent response"],
  "viewUrl": "/operator-studio/threads/thread-a1b2c3..."
}
```

Open `$OPERATOR_STUDIO_URL$viewUrl` and the thread's waiting in your Imported
queue, ready to review and promote.
