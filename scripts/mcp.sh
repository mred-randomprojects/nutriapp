#!/bin/sh
# Starts the NutriApp MCP server (cli/mcp.ts) for Claude Code, building it first
# so it always runs the checked-out code. stdout is the MCP channel, so the
# build's output goes to stderr.
#
#   claude mcp add --scope user nutriapp -- /path/to/nutriapp/scripts/mcp.sh
set -e
cd "$(dirname "$0")/.."
# Claude Code may start servers without the login shell's PATH: find node and gcloud.
export PATH="$HOME/google-cloud-sdk/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh" >&2
fi
./node_modules/.bin/tsc -p tsconfig.cli.json >&2
exec node .tmp/cli-dist/cli/mcp.js
