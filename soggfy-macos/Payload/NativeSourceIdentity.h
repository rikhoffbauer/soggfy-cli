#pragma once

#include <cstdint>
#include <string_view>

struct NativeSourceIdentityBindingInputs {
    uint64_t pendingGeneration = 0;
    uintptr_t pendingSource = 0;
    uint64_t pendingThreadId = 0;
    uint64_t pendingScopeToken = 0;
    uintptr_t pendingScopeSiteOffset = 0;

    uint64_t currentThreadId = 0;
    uint64_t currentScopeToken = 0;
    uintptr_t currentScopeSiteOffset = 0;

    bool generationLive = false;
    bool alreadyBound = false;
    bool sharedCallFrame = false;
    std::string_view fileId;
};

inline bool LooksLikeCanonicalSpotifyFileId(std::string_view value) {
    if (value.size() != 40) return false;
    for (const char c : value) {
        const bool digit = c >= '0' && c <= '9';
        const bool lowerHex = c >= 'a' && c <= 'f';
        const bool upperHex = c >= 'A' && c <= 'F';
        if (!digit && !lowerHex && !upperHex) return false;
    }
    return true;
}

inline bool CanBindExactNativeSourceIdentity(
    const NativeSourceIdentityBindingInputs& input
) {
    return input.pendingGeneration != 0 &&
        input.pendingSource != 0 &&
        input.pendingThreadId == input.currentThreadId &&
        input.pendingScopeToken != 0 &&
        input.pendingScopeToken == input.currentScopeToken &&
        input.pendingScopeSiteOffset != 0 &&
        input.pendingScopeSiteOffset == input.currentScopeSiteOffset &&
        input.generationLive &&
        !input.alreadyBound &&
        input.sharedCallFrame &&
        LooksLikeCanonicalSpotifyFileId(input.fileId);
}
