with open("/Volumes/Repositories/soggfy-macos-review-fix/soggfy-macos/Payload/DecodeHook.mm", "r") as f:
    content = f.read()

log_file_hook = """
    FILE* f = fopen("/tmp/soggfy_hook.txt", "a");
    if(f) {
        fprintf(f, "Soggfy: InitVorbis called! Return address (unslid) is 0x%lx\\n", ret_addr - slide);
        fclose(f);
    }
"""

content = content.replace('fprintf(stderr, "Soggfy: InitVorbis called! Return address (unslid) is 0x%lx\\n", ret_addr - slide);', log_file_hook)

log_file_install = """
    FILE* f = fopen("/tmp/soggfy_hook.txt", "a");
    if(f) {
        fprintf(f, "Soggfy: Hooking InitVorbis at 0x%lx (slide 0x%lx)\\n", target, slide);
        fclose(f);
    }
"""

content = content.replace('fprintf(stderr, "Soggfy: Hooking InitVorbis at 0x%lx (slide 0x%lx)\\n", target, slide);', log_file_install)

with open("/Volumes/Repositories/soggfy-macos-review-fix/soggfy-macos/Payload/DecodeHook.mm", "w") as f:
    f.write(content)
