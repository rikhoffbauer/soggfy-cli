import re

with open("/Volumes/Repositories/soggfy-macos-review-fix/soggfy-macos/Payload/DecodeHook.mm", "r") as f:
    content = f.read()

hook_code = """
#include <mach-o/dyld.h>

static void* (*InitVorbis_Orig)(void* a, void* b, void* c, void* d, void* e, void* f, void* g, void* h);
static void* InitVorbis_Hook(void* a, void* b, void* c, void* d, void* e, void* f, void* g, void* h) {
    uintptr_t ret_addr = (uintptr_t)__builtin_return_address(0);
    uintptr_t slide = _dyld_get_image_vmaddr_slide(0);
    os_log_error(OS_LOG_DEFAULT, "Soggfy: InitVorbis called! Return address (unslid) is 0x%lx", ret_addr - slide);
    return InitVorbis_Orig(a, b, c, d, e, f, g, h);
}
"""

content = content.replace('#include "DecodeHook.h"', '#include "DecodeHook.h"\n' + hook_code)

install_hook = """
    intptr_t slide = _dyld_get_image_vmaddr_slide(0);
    uintptr_t target = slide + 0x10127f714;
    os_log_error(OS_LOG_DEFAULT, "Soggfy: Hooking InitVorbis at 0x%lx (slide 0x%lx)", target, slide);
    DobbyHook((void*)target, (void*)InitVorbis_Hook, (void**)&InitVorbis_Orig);
"""

content = content.replace("void InstallDecoderHook() {", "void InstallDecoderHook() {\n" + install_hook)

with open("/Volumes/Repositories/soggfy-macos-review-fix/soggfy-macos/Payload/DecodeHook.mm", "w") as f:
    f.write(content)

