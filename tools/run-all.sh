#!/bin/sh
# Laeuft jede Testsuite einzeln, statt beim ersten Fehler abzubrechen.
cd "$(dirname "$0")/.."
unset ELECTRON_RUN_AS_NODE
for s in $(node -e "const p=require('./package.json');console.log(p.scripts.test.match(/test:[a-z0-9:]+/g).join(' '))"); do
  out=$(npm run -s "$s" 2>&1); code=$?
  summary=$(printf '%s\n' "$out" | grep -E '[0-9]+/[0-9]+ bestanden' | tail -1)
  printf '%-16s exit=%s  %s\n' "$s" "$code" "$summary"
  printf '%s\n' "$out" | grep -E '^FAIL' | sed 's/^/    /'
done
