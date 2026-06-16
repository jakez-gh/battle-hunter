#!/usr/bin/env bash
set -e

if ! command -v node &>/dev/null; then
    echo "Node.js is required to run this game."
    echo "Install it from https://nodejs.org and re-run this script."
    exit 1
fi

echo "Starting Battle Hunter at http://localhost:8377"

# Open browser in background; retry-friendly since the server starts right after
if command -v xdg-open &>/dev/null; then
    (sleep 1 && xdg-open http://localhost:8377) &
elif command -v open &>/dev/null; then
    (sleep 1 && open http://localhost:8377) &
else
    echo "Open http://localhost:8377 in your browser."
fi

node tools/serve.mjs
