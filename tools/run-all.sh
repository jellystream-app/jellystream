#!/bin/sh
# Laeuft jede Testsuite einzeln, statt beim ersten Fehler abzubrechen,
# mit Zeitlimit je Suite — ein haengender Test soll nicht alles blockieren.
#   sh tools/run-all.sh            alle aus "npm test"
#   sh tools/run-all.sh ui rows    nur diese
cd "$(dirname "$0")/.."
# VS Code setzt das in seinen Terminals; Electron startet dann als Node
unset ELECTRON_RUN_AS_NODE
if [ $# -gt 0 ]; then
  suites=$(for s in "$@"; do printf 'test:%s ' "$s"; done)
else
  suites=$(node -e "const p=require('./package.json');console.log(p.scripts.test.match(/test:[a-z0-9:]+/g).join(' '))")
fi
fail=0
for s in $suites; do
  out=$(timeout 180 npm run -s "$s" 2>&1); code=$?
  summary=$(printf '%s\n' "$out" | grep -E '[0-9]+/[0-9]+ bestanden|Ergebnis:' | tail -1)
  [ $code -eq 124 ] && summary="ZEITLIMIT"
  printf '%-18s exit=%s  %s\n' "$s" "$code" "$summary"
  printf '%s\n' "$out" | grep -E '^FAIL|\[FEHLER\]' | sed 's/^/    /'
  [ $code -ne 0 ] && fail=1
done
exit $fail
