#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if command -v xcrun >/dev/null 2>&1; then
  compiler="${CXX:-xcrun clang++}"
else
  compiler="${CXX:-c++}"
fi
tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/soggfy-state-fixture.XXXXXX")"
trap 'rm -rf "$tmpdir"' EXIT
$compiler -std=c++20 -Isoggfy-macos/Payload \
  soggfy-macos/Payload/StateManager.cpp \
  soggfy-macos/tests/state_manager_fixture.cpp \
  -o "$tmpdir/state_manager_fixture"
"$tmpdir/state_manager_fixture"
