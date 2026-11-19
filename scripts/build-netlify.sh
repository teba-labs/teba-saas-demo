#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

rm -rf dist
mkdir -p dist

for directory in app assets config core dashboard modules offline portal website; do
  test -d "$directory"
  cp -R "$directory" dist/
done

test -f service-worker.js
cp service-worker.js dist/

# The public deploy must contain browser-facing files only.
test -f dist/app/index.html
test ! -e dist/database
test ! -e dist/docs
test ! -e dist/supabase
test ! -e dist/source_original
test ! -e dist/.github
test ! -e dist/tests
test ! -e dist/node_modules
