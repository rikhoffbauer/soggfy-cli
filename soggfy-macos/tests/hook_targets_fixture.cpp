#include "../Payload/SpotifyHookTargets.h"
#include <cassert>
#include <cstring>
#include <iostream>

int main() {
  const auto* oldTargets = SpotifyHookTargetsForVersion("1.2.98.301");
  assert(oldTargets != nullptr);
  assert(oldTargets->decodeAudioDataOffset == 0x127fe94);
  assert(oldTargets->oggStreamPageinOffset == 0x12b32c8);
  assert(SpotifyHookFamilyForVersion("1.2.98.301") == SpotifyHookFamily::OggV1);
  assert(SpotifyHookFamilyConfigForFamily(SpotifyHookFamily::OggV1).oggPageinSuccessReturn == 1);

  const auto* newTargets = SpotifyHookTargetsForVersion("1.2.99.317");
  assert(newTargets != nullptr);
  assert(newTargets->decodeAudioDataOffset == 0x1293f04);
  assert(newTargets->oggStreamPageinOffset == 0x12c84e4);
  assert(SpotifyHookFamilyForVersion("1.2.99.317") == SpotifyHookFamily::OggV1);

  const auto* latestTargets = SpotifyHookTargetsForVersion("1.3.0.277");
  assert(latestTargets != nullptr);
  assert(latestTargets->decodeAudioDataOffset == 0x12f7384);
  assert(latestTargets->oggStreamPageinOffset == 0x132b91c);
  assert(SpotifyHookFamilyForVersion("1.3.0.277") == SpotifyHookFamily::OggV1);

  assert(SpotifyHookTargetsForVersion("1.2.99.318") == nullptr);
  assert(SpotifyHookFamilyForVersion("1.2.99.318") == SpotifyHookFamily::Unsupported);
  assert(SpotifyHookTargetsForVersion(nullptr) == nullptr);
  std::cout << "hook target fixture passed\n";
}
