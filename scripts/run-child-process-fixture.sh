#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PAYLOAD="$ROOT_DIR/soggfy-macos/build/libsoggfy.dylib"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/soggfy-child.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT
cat > "$TEST_DIR/child_fixture.c" <<'C'
#include <stdlib.h>
#include <stdio.h>
#include <sys/wait.h>
int main(void) {
  if (getenv("DYLD_INSERT_LIBRARIES") != NULL) return 10;
  int rc = system("/usr/sbin/lsof -v >/dev/null 2>&1");
  if (rc == -1 || !WIFEXITED(rc) || WEXITSTATUS(rc) != 0) return 11;
  puts("soggfy-child-ok");
  return 0;
}
C
clang -arch arm64 "$TEST_DIR/child_fixture.c" -o "$TEST_DIR/child_fixture"
result="$(DYLD_INSERT_LIBRARIES="$PAYLOAD" SOGGFY_SAVE_PATH="$TEST_DIR" "$TEST_DIR/child_fixture")"
[[ "$result" == soggfy-child-ok ]] || { echo "DYLD inheritance fixture failed: $result" >&2; exit 1; }
[[ -z "$(find "$TEST_DIR" -maxdepth 1 -type f ! -name child_fixture ! -name child_fixture.c -print -quit)" ]] || {
  echo 'Payload wrote runtime files for an unrelated process' >&2; exit 1;
}
echo 'DYLD child inheritance fixture passed'
