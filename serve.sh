#!/usr/bin/env bash
# Run a local HTTP server so the app can be tested before deploying.
cd "$(dirname "$0")"
echo "Serving outfit-planner at http://127.0.0.1:5173/"
echo "Press Ctrl+C to stop."
if command -v python3 >/dev/null; then
  python3 -m http.server 5173 --bind 127.0.0.1
elif command -v python >/dev/null; then
  python -m http.server 5173 --bind 127.0.0.1
elif command -v npx >/dev/null; then
  npx --yes serve -p 5173 -L
else
  echo "Neither python nor npx was found. Install Python or Node.js and try again."
  exit 1
fi
