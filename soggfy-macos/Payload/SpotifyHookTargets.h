#pragma once

#include <cstdint>
#include <cstring>

enum class SpotifyHookFamily : uint8_t {
  Unsupported = 0,
  OggV1 = 1,
};

struct SpotifyHookFamilyConfig {
  int oggPageinSuccessReturn;
};

inline SpotifyHookFamilyConfig SpotifyHookFamilyConfigForFamily(SpotifyHookFamily family) {
  switch (family) {
    case SpotifyHookFamily::OggV1:
      return {1};
    case SpotifyHookFamily::Unsupported:
      return {0};
  }
  return {0};
}

struct SpotifyHookTargets {
  const char* version;
  uintptr_t decodeAudioDataOffset;
  uintptr_t oggStreamPageinOffset;
  SpotifyHookFamily family;
};

inline const SpotifyHookTargets* SpotifyHookTargetsForVersion(const char* version) {
  if (!version) return nullptr;
  static constexpr SpotifyHookTargets targets[] = {
      {"1.2.98.301", 0x127fe94, 0x12b32c8, SpotifyHookFamily::OggV1},
      {"1.2.99.317", 0x1293f04, 0x12c84e4, SpotifyHookFamily::OggV1},
      {"1.3.0.277", 0x12f7384, 0x132b91c, SpotifyHookFamily::OggV1},
  };
  for (const auto& target : targets) {
    if (std::strcmp(version, target.version) == 0) return &target;
  }
  return nullptr;
}

inline SpotifyHookFamily SpotifyHookFamilyForVersion(const char* version) {
  const auto* targets = SpotifyHookTargetsForVersion(version);
  return targets ? targets->family : SpotifyHookFamily::Unsupported;
}
