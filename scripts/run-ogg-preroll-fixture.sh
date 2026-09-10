#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if command -v xcrun >/dev/null 2>&1; then
  compiler="${CXX:-xcrun clang++}"
else
  compiler="${CXX:-c++}"
fi
tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/soggfy-ogg-preroll-fixture.XXXXXX")"
trap 'rm -rf "$tmpdir"' EXIT
$compiler -std=c++20 -Isoggfy-macos/Payload \
  soggfy-macos/Payload/OggPreRoll.cpp \
  soggfy-macos/tests/ogg_preroll_fixture.cpp \
  -o "$tmpdir/ogg_preroll_fixture"
"$tmpdir/ogg_preroll_fixture"
