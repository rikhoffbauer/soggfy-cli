with open("/Volumes/Repositories/soggfy-macos-review-fix/soggfy-macos/Payload/DecodeHook.mm", "r") as f:
    content = f.read()

content = content.replace('os_log_error(OS_LOG_DEFAULT, "Soggfy: InitVorbis called! Return address (unslid) is 0x%lx", ret_addr - slide);', 'fprintf(stderr, "Soggfy: InitVorbis called! Return address (unslid) is 0x%lx\\n", ret_addr - slide);')
content = content.replace('os_log_error(OS_LOG_DEFAULT, "Soggfy: Hooking InitVorbis at 0x%lx (slide 0x%lx)", target, slide);', 'fprintf(stderr, "Soggfy: Hooking InitVorbis at 0x%lx (slide 0x%lx)\\n", target, slide);')

with open("/Volumes/Repositories/soggfy-macos-review-fix/soggfy-macos/Payload/DecodeHook.mm", "w") as f:
    f.write(content)
