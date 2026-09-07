with open("/Volumes/Repositories/soggfy-macos-review-fix/soggfy-macos/Payload/DecodeHook.mm", "r") as f:
    content = f.read()

# Replace the DECODER_PATTERN
content = content.replace('static const char* DECODER_PATTERN = "f6 57 05 a9 f4 4f 06 a9 fd 7b 07 a9 fd c3 01 91 f3 03 00 aa 00 60 40 91";', 'static const char* DECODER_PATTERN = "ff 43 01 d1 f8 5f 01 a9 f6 57 02 a9 f4 4f 03 a9 fd 7b 04 a9 fd 03 01 91";')

# Restore InstallDecoderHook
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

# Replace everything from void InstallDecoderHook() to the end
import re
content = re.sub(r'void InstallDecoderHook\(\) \{.*', install_hook_orig, content, flags=re.DOTALL)

with open("/Volumes/Repositories/soggfy-macos-review-fix/soggfy-macos/Payload/DecodeHook.mm", "w") as f:
    f.write(content)
