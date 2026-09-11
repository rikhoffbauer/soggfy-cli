#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${TMPDIR:-/tmp}/soggfy-hook-targets-fixture"

xcrun --sdk macosx clang++ \
  -std=c++17 \
  "$ROOT/soggfy-macos/tests/hook_targets_fixture.cpp" \
  -o "$OUT"
"$OUT"
