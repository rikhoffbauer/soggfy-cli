#include "../Payload/NativeSourceIdentity.h"

#include <cassert>
#include <iostream>
#include <string>

static NativeSourceIdentityBindingInputs Valid() {
    NativeSourceIdentityBindingInputs input;
    input.pendingGeneration = 7;
    input.pendingSource = 0x12345078;
    input.pendingThreadId = 42;
    input.pendingScopeToken = 99;
    input.pendingScopeSiteOffset = 0x656d1c;
    input.currentThreadId = 42;
    input.currentScopeToken = 99;
    input.currentScopeSiteOffset = 0x656d1c;
    input.generationLive = true;
    input.alreadyBound = false;
    input.sharedCallFrame = true;
    input.fileId = "f38702bf00c1b1271576c399dbc5713f2412132a";
    return input;
}

int main() {
    auto input = Valid();
    assert(CanBindExactNativeSourceIdentity(input));

    input = Valid();
    input.currentThreadId++;
    assert(!CanBindExactNativeSourceIdentity(input));

    input = Valid();
    input.currentScopeToken++;
    assert(!CanBindExactNativeSourceIdentity(input));

    input = Valid();
    input.currentScopeSiteOffset = 0xc9cdd4;
    assert(!CanBindExactNativeSourceIdentity(input));

    input = Valid();
    input.generationLive = false;
    assert(!CanBindExactNativeSourceIdentity(input));

    input = Valid();
    input.alreadyBound = true;
    assert(!CanBindExactNativeSourceIdentity(input));

    input = Valid();
    input.sharedCallFrame = false;
    assert(!CanBindExactNativeSourceIdentity(input));

    input = Valid();
    input.pendingGeneration = 0;
    assert(!CanBindExactNativeSourceIdentity(input));

    input = Valid();
    input.pendingSource = 0;
    assert(!CanBindExactNativeSourceIdentity(input));

    input = Valid();
    input.pendingScopeToken = 0;
    assert(!CanBindExactNativeSourceIdentity(input));

    input = Valid();
    input.fileId = "";
    assert(!CanBindExactNativeSourceIdentity(input));

    input = Valid();
    input.fileId = "f38702bf00c1b1271576c399dbc5713f2412132";
    assert(!CanBindExactNativeSourceIdentity(input));

    input = Valid();
    input.fileId = "g38702bf00c1b1271576c399dbc5713f2412132a";
    assert(!CanBindExactNativeSourceIdentity(input));

    assert(LooksLikeCanonicalSpotifyFileId(
        "F38702BF00C1B1271576C399DBC5713F2412132A"));

    auto duplicate = Valid();
    assert(CanBindExactNativeSourceIdentity(duplicate));
    duplicate.alreadyBound = true;
    assert(!CanBindExactNativeSourceIdentity(duplicate));

    std::cout << "native source identity fixture passed\n";
}
