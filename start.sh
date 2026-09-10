#!/bin/sh
cd "$(dirname "$0")"
echo "Opening roomcode.lol at http://127.0.0.1:3847"
echo "Leave this window open. Ctrl+C to stop."
node server.js
