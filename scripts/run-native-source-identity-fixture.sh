#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/soggfy-native-source-identity-fixture.XXXXXX")"
trap 'rm -rf "$tmpdir"' EXIT
OUT="$tmpdir/native_source_identity_fixture"

xcrun --sdk macosx clang++ \
  -std=c++17 \
  "$ROOT/soggfy-macos/tests/native_source_identity_fixture.cpp" \
  -o "$OUT"
"$OUT"
