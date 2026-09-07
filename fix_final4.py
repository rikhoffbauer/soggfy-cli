with open("/Volumes/Repositories/soggfy-macos-review-fix/soggfy-macos/Payload/DecodeHook.mm", "r") as f:
    content = f.read()

content = content.replace('if (!param_3 || !param_2) {', 'if (!param_3 || !param_4) {')
content = content.replace('int ret = DecodeAudioData_Orig(x0, param_1, param_2, param_3, param_4);', 'int ret = DecodeAudioData_Orig(x0, x1, x2, param_3, param_4, x5);')

with open("/Volumes/Repositories/soggfy-macos-review-fix/soggfy-macos/Payload/DecodeHook.mm", "w") as f:
    f.write(content)
