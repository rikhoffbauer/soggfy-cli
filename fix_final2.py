import re
with open("/Volumes/Repositories/soggfy-macos-review-fix/soggfy-macos/Payload/DecodeHook.mm", "r") as f:
    content = f.read()

install_hook_orig = """void InstallDecoderHook() {
    uintptr_t decoderAddr = Scanner::FindPattern("Spotify", DECODER_PATTERN);
    if (decoderAddr != 0) {
        printf("Soggfy: Found DecodeAudioData at 0x%lx. Hooking...\\n", decoderAddr);
        DobbyHook((void*)decoderAddr, (void*)DecodeAudioData_Hook, (void**)&DecodeAudioData_Orig);
    } else {
        printf("Soggfy: DecodeAudioData pattern not found.\\n");
    }
}
"""

content = re.sub(r'void InstallDecoderHook\(\) \{.*', install_hook_orig, content, flags=re.DOTALL)

with open("/Volumes/Repositories/soggfy-macos-review-fix/soggfy-macos/Payload/DecodeHook.mm", "w") as f:
    f.write(content)
