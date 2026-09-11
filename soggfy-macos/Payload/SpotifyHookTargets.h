#pragma once

#include <cstdint>
#include <cstring>

struct SpotifyHookTargets {
  const char* version;
  uintptr_t decodeAudioDataOffset;
  uintptr_t oggStreamPageinOffset;
};

inline const SpotifyHookTargets* SpotifyHookTargetsForVersion(const char* version) {
  if (!version) return nullptr;
  static constexpr SpotifyHookTargets targets[] = {
      {"1.2.98.301", 0x127fe94, 0x12b32c8},
      {"1.2.99.317", 0x1293f04, 0x12c84e4},
  };
  for (const auto& target : targets) {
    if (std::strcmp(version, target.version) == 0) return &target;
  }
  return nullptr;
}
