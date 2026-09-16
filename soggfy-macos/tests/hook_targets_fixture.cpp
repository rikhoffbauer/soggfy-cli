#include "../Payload/SpotifyHookTargets.h"
#include <cassert>
#include <cstring>
#include <cstdlib>
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

  SpotifyHookTargets discovered{};
  setenv("SOGGFY_COMPAT_ALLOW_DISCOVERED_TARGETS", "1", 1);
  setenv("SOGGFY_COMPAT_EXPECTED_VERSION", "1.3.1.123", 1);
  setenv("SOGGFY_COMPAT_HOOK_FAMILY", "OggV1", 1);
  setenv("SOGGFY_COMPAT_DECODE_OFFSET", "0x13183ac", 1);
  setenv("SOGGFY_COMPAT_OGG_PAGEIN_OFFSET", "0x134cf10", 1);
  assert(SpotifyHookTargetsForCompatibilityEnvironment("1.3.1.123", &discovered));
  assert(discovered.decodeAudioDataOffset == 0x13183ac);
  assert(discovered.oggStreamPageinOffset == 0x134cf10);
  assert(discovered.family == SpotifyHookFamily::OggV1);
  assert(!SpotifyHookTargetsForCompatibilityEnvironment("1.3.1.124", &discovered));
  unsetenv("SOGGFY_COMPAT_ALLOW_DISCOVERED_TARGETS");

  assert(SpotifyHookTargetsForVersion("1.2.99.318") == nullptr);
  assert(SpotifyHookFamilyForVersion("1.2.99.318") == SpotifyHookFamily::Unsupported);
  assert(SpotifyHookTargetsForVersion(nullptr) == nullptr);
  std::cout << "hook target fixture passed\n";
}
