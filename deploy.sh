#!/bin/bash
# Requires: GitHub CLI (gh) — install with `brew install gh && gh auth login`
set -e

echo "Running build check..."
npm run build

echo ""
echo "Build passed! Pushing..."
COMMIT_SHA=$(git rev-parse HEAD)
git ps -f

echo ""
echo "Waiting for GitHub Actions run to appear for $COMMIT_SHA..."

MAX_ATTEMPTS=30
ATTEMPT=0
RUN_ID=""
while [ -z "$RUN_ID" ]; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ "$ATTEMPT" -gt "$MAX_ATTEMPTS" ]; then
    echo "❌ Timed out waiting for workflow run to appear."
    exit 1
  fi
  RUN_ID=$(gh run list --commit "$COMMIT_SHA" --workflow deploy.yml --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)
  if [ -z "$RUN_ID" ]; then
    sleep 2
  fi
done

echo "Found run $RUN_ID — watching..."

if gh run watch "$RUN_ID" --exit-status; then
  osascript -e 'display notification "Deploy succeeded!" with title "NutriApp" sound name "Glass"'
  echo "✅ Deploy complete!"
else
  osascript -e 'display notification "Deploy FAILED" with title "NutriApp" sound name "Basso"'
  echo "❌ Deploy failed — check GitHub Actions."
  exit 1
fi
