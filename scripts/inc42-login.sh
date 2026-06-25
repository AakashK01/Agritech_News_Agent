#!/usr/bin/env bash
# Log in to Inc42 via plain Chrome (Google OAuth), then export session for agent-browser.
# Sign in once, press Enter to save inc42-auth.json, quit Chrome, then run: npm run dev

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE_DIR="$ROOT/profiles/inc42"
PROFILE="$PROFILE_DIR/browser-data"
AUTH_STATE="$PROFILE_DIR/inc42-auth.json"
CHROME="${CHROME_PATH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
DEBUG_PORT="${INC42_DEBUG_PORT:-9222}"
LOGIN_URL="${INC42_LOGIN_URL:-https://inc42.com/industry/agritech/}"
AGENT_BROWSER="$ROOT/node_modules/agent-browser/bin/agent-browser.js"

if [[ ! -x "$CHROME" ]]; then
  echo "Chrome not found at: $CHROME" >&2
  echo "Set CHROME_PATH to your Chrome executable." >&2
  exit 1
fi

if [[ ! -f "$AGENT_BROWSER" ]]; then
  echo "agent-browser not found — run: npm install" >&2
  exit 1
fi

mkdir -p "$PROFILE"

rm -f "$PROFILE/SingletonLock" "$PROFILE/SingletonSocket" "$PROFILE/SingletonCookie" \
      "$PROFILE/DevToolsActivePort" "$PROFILE/RunningChromeVersion" 2>/dev/null || true

echo "Opening Inc42 in Chrome with remote debugging (port $DEBUG_PORT)."
echo "Profile: $PROFILE"
echo ""
echo "1. Sign in with Google when prompted."
echo "2. Confirm the agritech feed shows article listings (not a login wall)."
echo "3. Press Enter here to save the session for npm run dev."
echo ""
echo "Note: npm run dev opens a separate Chrome window. Auth comes from inc42-auth.json,"
echo "      not the browser-data profile — that is expected."
echo ""

"$CHROME" \
  --user-data-dir="$PROFILE" \
  --remote-debugging-port="$DEBUG_PORT" \
  --no-first-run \
  --no-default-browser-check \
  "$LOGIN_URL" &

CHROME_PID=$!

cleanup() {
  if kill -0 "$CHROME_PID" 2>/dev/null; then
    kill "$CHROME_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

read -r -p "Press Enter after you are logged in and the feed loads... " _

echo ""
echo "Refreshing feed via CDP before saving auth state..."

cd "$PROFILE_DIR"
if ! node "$AGENT_BROWSER" --auto-connect open "$LOGIN_URL"; then
  echo "Failed to open feed via CDP. Is Chrome still running on port $DEBUG_PORT?" >&2
  exit 1
fi

if ! node "$AGENT_BROWSER" --auto-connect wait --load networkidle; then
  echo "Failed waiting for feed load via CDP." >&2
  exit 1
fi

echo "Saving auth state to $AUTH_STATE ..."
if ! node "$AGENT_BROWSER" --auto-connect state save ./inc42-auth.json; then
  echo "Failed to save auth state. Is Chrome still running on port $DEBUG_PORT?" >&2
  exit 1
fi

if ! node -e "
const fs = require('fs');
const state = JSON.parse(fs.readFileSync('$AUTH_STATE', 'utf8'));
const cookies = state.cookies || [];
const origins = state.origins || [];
const hasWpLogin = cookies.some(c => String(c.name || '').startsWith('wordpress_logged_in'));
if (!hasWpLogin) {
  console.error('Saved state missing wordpress_logged_in cookie — sign in and try again.');
  process.exit(1);
}
if (origins.length === 0) {
  console.error('Saved state has no origin storage (localStorage). Auth may not persist in npm run dev.');
  console.error('Ensure the agritech feed is loaded (not a login wall) before pressing Enter.');
  process.exit(1);
}
console.log('Validated: ' + cookies.length + ' cookies, ' + origins.length + ' origin(s) with storage');
"; then
  exit 1
fi

echo ""
echo "Session saved to profiles/inc42/inc42-auth.json"
echo "Quit Chrome completely (Cmd+Q), then run: npm run dev"
