#!/usr/bin/env bash
# Log in to Inc42 via plain Chrome (Google OAuth), then export session for agent-browser.
# Sign in once, press Enter to save inc42-auth.json, quit Chrome, then run: npm run dev

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE_DIR="$ROOT/profiles/inc42"
PROFILE="$PROFILE_DIR/browser-data"
AUTH_STATE="$PROFILE_DIR/inc42-auth.json"
SAVE_AUTH="$ROOT/scripts/inc42-save-auth.mjs"
CHROME="${CHROME_PATH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
DEBUG_PORT="${INC42_DEBUG_PORT:-9222}"
LOGIN_URL="${INC42_LOGIN_URL:-https://inc42.com/industry/agritech/}"

if [[ ! -x "$CHROME" ]]; then
  echo "Chrome not found at: $CHROME" >&2
  echo "Set CHROME_PATH to your Chrome executable." >&2
  exit 1
fi

if [[ ! -f "$ROOT/node_modules/agent-browser/bin/agent-browser.js" ]]; then
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
echo "2. Stay on the Inc42 agritech feed tab — close any extra tabs (e.g. Gemini)."
echo "3. Click the Inc42 tab so it is the active window before pressing Enter."
echo "4. Confirm article listings are visible (not a login wall)."
echo "5. Press Enter here to save the session for npm run dev."
echo ""
echo "Important: Close extra tabs (e.g. Gemini). The save step reads cookies from your Chrome session."
echo "Note: npm run dev opens a separate Chrome window using inc42-auth.json."
echo ""

"$CHROME" \
  --user-data-dir="$PROFILE" \
  --remote-debugging-port="$DEBUG_PORT" \
  --no-first-run \
  --no-default-browser-check \
  "$LOGIN_URL" &

CHROME_PID=$!

cleanup_chrome() {
  if kill -0 "$CHROME_PID" 2>/dev/null; then
    kill "$CHROME_PID" 2>/dev/null || true
  fi
}

read -r -p "Press Enter after you are logged in and the feed loads... " _

echo ""
echo "Saving auth state via CDP (no agent-browser — no new tabs or windows)..."

if ! node "$SAVE_AUTH" \
  "$PROFILE_DIR" \
  "$DEBUG_PORT" \
  "./inc42-auth.json"; then
  echo "" >&2
  echo "Save failed — Chrome left open so you can fix the Inc42 tab and re-run: npm run inc42:login" >&2
  exit 1
fi

cleanup_chrome

echo ""
echo "Session saved to profiles/inc42/inc42-auth.json"
echo "Quit Chrome completely (Cmd+Q) if still open, then run: npm run dev"
