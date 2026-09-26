#!/usr/bin/env bash
# The device gate (plan R1): Maestro flows on the Samsung, with the release
# APK installed. Maestro cannot turn the phone, so the rotation test is this
# script's: it starts a deal by flow, turns the phone twenty times through adb,
# and asks Maestro whether the table is still standing.
#
#   bash scripts/device-flows.sh            # every flow
#   bash scripts/device-flows.sh 02         # one, by its number
#
# Needs: maestro on PATH (or ~/maestro/bin), adb, ANDROID_SERIAL set to the
# test phone (never the player's own), the app in front of nothing else.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export ANDROID_SERIAL=${ANDROID_SERIAL:-RF8R513DNTP}
MAESTRO=$(command -v maestro || echo "$HOME/maestro/bin/maestro")
ONLY=${1:-}
FLOWS=apps/mobile/maestro

run() {
  local f=$1
  echo "== $f"
  "$MAESTRO" --device "$ANDROID_SERIAL" test "$FLOWS/$f"
}

[ -z "$ONLY" ] || [ "$ONLY" = 01 ] && run 01-home.yaml
[ -z "$ONLY" ] || [ "$ONLY" = 02 ] && run 02-offline-deal.yaml
[ -z "$ONLY" ] || [ "$ONLY" = 03 ] && run 03-settings-golden.yaml

if [ -z "$ONLY" ] || [ "$ONLY" = 04 ]; then
  echo "== 04: a deal, then twenty turns of the phone"
  # Whatever happens below, the phone turns by itself again afterwards.
  trap 'adb shell settings put system user_rotation 0; adb shell settings put system accelerometer_rotation 1' EXIT
  adb shell settings put system accelerometer_rotation 0
  adb shell am force-stop com.slfresh.belastih
  # Into an offline table (the first half of flow 02, stopped once the fan shows).
  # Maestro reads flows from files only, so the inline one goes through a temp file.
  FLOW=$(mktemp -t bela-flow-XXXX.yaml 2>/dev/null || echo "${TMPDIR:-/tmp}/bela-flow-$$.yaml")
  cat > "$FLOW" <<'EOF'
appId: com.slfresh.belastih
---
- launchApp
- extendedWaitUntil:
    visible:
      id: "home-offline"
    timeout: 20000
- tapOn:
    id: "home-offline"
- extendedWaitUntil:
    visible:
      id: "card-.*"
    timeout: 20000
EOF
  "$MAESTRO" --device "$ANDROID_SERIAL" test "$FLOW"
  rm -f "$FLOW"
  for i in $(seq 1 20); do
    adb shell settings put system user_rotation $(( i % 2 ))
    sleep 1.5
  done
  adb shell settings put system user_rotation 0
  adb shell settings put system accelerometer_rotation 1
  run 04-table-alive.yaml
fi
echo "== device flows passed"
