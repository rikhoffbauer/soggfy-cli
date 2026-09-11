#include "../Payload/SpotifyHookTargets.h"
#include <cassert>
#include <cstring>
#include <iostream>

int main() {
  const auto* oldTargets = SpotifyHookTargetsForVersion("1.2.98.301");
  assert(oldTargets != nullptr);
  assert(oldTargets->decodeAudioDataOffset == 0x127fe94);
  assert(oldTargets->oggStreamPageinOffset == 0x12b32c8);

  const auto* newTargets = SpotifyHookTargetsForVersion("1.2.99.317");
  assert(newTargets != nullptr);
  assert(newTargets->decodeAudioDataOffset == 0x1293f04);
  assert(newTargets->oggStreamPageinOffset == 0x12c84e4);

  assert(SpotifyHookTargetsForVersion("1.2.99.318") == nullptr);
  assert(SpotifyHookTargetsForVersion(nullptr) == nullptr);
  std::cout << "hook target fixture passed\n";
}
