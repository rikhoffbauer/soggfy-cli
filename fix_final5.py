with open("/Volumes/Repositories/soggfy-macos-review-fix/soggfy-macos/Payload/DecodeHook.mm", "r") as f:
    content = f.read()

content = content.replace('#include <vector>', '#include <vector>\n#import <Foundation/Foundation.h>')
content = content.replace('printf("Soggfy: Found DecodeAudioData at 0x%lx. Hooking...\\n", decoderAddr);', 'NSLog(@"Soggfy: Found DecodeAudioData at 0x%lx", decoderAddr);')
content = content.replace('printf("Soggfy: DecodeAudioData pattern not found.\\n");', 'NSLog(@"Soggfy: DecodeAudioData pattern not found");')

with open("/Volumes/Repositories/soggfy-macos-review-fix/soggfy-macos/Payload/DecodeHook.mm", "w") as f:
    f.write(content)
