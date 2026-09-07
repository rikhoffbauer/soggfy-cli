#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if command -v xcrun >/dev/null 2>&1; then
  compiler="${CXX:-xcrun clang++}"
else
  compiler="${CXX:-c++}"
fi
mkdir -p .tmp
$compiler -std=c++20 -Isoggfy-macos/Payload \
  soggfy-macos/Payload/StateManager.cpp \
  soggfy-macos/tests/state_manager_fixture.cpp \
  -o .tmp/state_manager_fixture
.tmp/state_manager_fixture
