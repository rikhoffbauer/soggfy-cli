#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/soggfy-hook-targets-fixture.XXXXXX")"
trap 'rm -rf "$tmpdir"' EXIT
OUT="$tmpdir/hook_targets_fixture"

xcrun --sdk macosx clang++ \
  -std=c++17 \
  "$ROOT/soggfy-macos/tests/hook_targets_fixture.cpp" \
  -o "$OUT"
"$OUT"
