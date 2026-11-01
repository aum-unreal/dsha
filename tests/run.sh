#!/data/data/com.termux/files/usr/bin/bash
# All checks: backend unit/e2e tests, then the browser UI test.
set -euo pipefail
cd "$(dirname "$0")/.."
node --test server/test/*.test.mjs
node tests/ui.cjs
