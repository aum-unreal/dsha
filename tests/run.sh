#!/data/data/com.termux/files/usr/bin/bash
# All checks: backend unit/e2e tests, then the browser UI test.
set -euo pipefail
cd "$(dirname "$0")/.."
node --test server/test/*.test.mjs
D=$(mktemp -d); javac --release 17 -d "$D" src/dev/aum/dsha/Sse.java src/dev/aum/dsha/Policy.java tests/SseCheck.java tests/PolicyCheck.java && java -cp "$D" dev.aum.dsha.SseCheck && java -cp "$D" dev.aum.dsha.PolicyCheck; rm -rf "$D"
node tests/ui.cjs
