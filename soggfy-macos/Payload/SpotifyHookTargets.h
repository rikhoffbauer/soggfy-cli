#pragma once

#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <cerrno>

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

inline bool SpotifyParseHookOffset(const char* raw, uintptr_t* value) {
  if (!raw || !*raw || !value) return false;
  errno = 0;
  char* end = nullptr;
  const unsigned long long parsed = std::strtoull(raw, &end, 0);
  if (errno != 0 || end == raw || !end || *end != '\0' || parsed == 0) return false;
  *value = static_cast<uintptr_t>(parsed);
  return true;
}

inline bool SpotifyHookTargetsForCompatibilityEnvironment(
    const char* version, SpotifyHookTargets* out) {
  if (!version || !out) return false;
  const char* allow = std::getenv("SOGGFY_COMPAT_ALLOW_DISCOVERED_TARGETS");
  const char* expectedVersion = std::getenv("SOGGFY_COMPAT_EXPECTED_VERSION");
  const char* family = std::getenv("SOGGFY_COMPAT_HOOK_FAMILY");
  if (!allow || std::strcmp(allow, "1") != 0 || !expectedVersion
      || std::strcmp(expectedVersion, version) != 0 || !family
      || std::strcmp(family, "OggV1") != 0) return false;
  uintptr_t decode = 0;
  uintptr_t ogg = 0;
  if (!SpotifyParseHookOffset(std::getenv("SOGGFY_COMPAT_DECODE_OFFSET"), &decode)
      || !SpotifyParseHookOffset(std::getenv("SOGGFY_COMPAT_OGG_PAGEIN_OFFSET"), &ogg)) return false;
  *out = {version, decode, ogg, SpotifyHookFamily::OggV1};
  return true;
}

inline SpotifyHookFamily SpotifyHookFamilyForVersion(const char* version) {
  const auto* targets = SpotifyHookTargetsForVersion(version);
  return targets ? targets->family : SpotifyHookFamily::Unsupported;
}
