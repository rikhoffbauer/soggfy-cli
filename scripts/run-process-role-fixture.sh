#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if command -v xcrun >/dev/null 2>&1; then
  compiler="${CXX:-xcrun clang++}"
else
  compiler="${CXX:-c++}"
fi
tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/soggfy-process-role-fixture.XXXXXX")"
trap 'rm -rf "$tmpdir"' EXIT
$compiler -std=c++20 -Isoggfy-macos/Payload \
  soggfy-macos/tests/process_role_fixture.cpp \
  -o "$tmpdir/process_role_fixture"
"$tmpdir/process_role_fixture"
