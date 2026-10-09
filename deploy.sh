#!/bin/bash
# Check, push main, and follow the Pages deploy to completion.
# Requires: GitHub CLI (gh). Run it from main.
set -euo pipefail

WORKFLOW="deploy.yml"   # the root site: WORKFLOW="pages-build-deployment"
NAME="$(basename "$(git rev-parse --show-toplevel)")"

if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
  echo "Not on main: only main deploys." >&2
  exit 1
fi

if [ -f package.json ]; then
  npm run check
  npm run build
fi

SHA="$(git rev-parse HEAD)"
# Never a plain --force. The lease refuses to overwrite commits pushed from
# elsewhere, and --force-if-includes stops an editor's background fetch from
# silently refreshing that lease. Re-pushing an amended commit still works.
git push --force-with-lease --force-if-includes origin main

echo "Waiting for the $WORKFLOW run of ${SHA:0:7}..."
RUN_ID=""
for _ in $(seq 1 30); do
  RUN_ID="$(gh run list --commit "$SHA" --workflow "$WORKFLOW" --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true)"
  [ -n "$RUN_ID" ] && break
  sleep 2
done
if [ -z "$RUN_ID" ]; then
  echo "No $WORKFLOW run appeared for ${SHA:0:7}." >&2
  exit 1
fi

if gh run watch "$RUN_ID" --exit-status; then
  osascript -e "display notification \"Deploy succeeded\" with title \"$NAME\" sound name \"Glass\""
else
  osascript -e "display notification \"Deploy FAILED\" with title \"$NAME\" sound name \"Basso\""
  exit 1
fi
