with open("/Volumes/Repositories/soggfy-macos-review-fix/soggfy-macos/Payload/DecodeHook.mm", "r") as f:
    content = f.read()

# Replace the DECODER_PATTERN
content = content.replace('static const char* DECODER_PATTERN = "ff 43 01 d1 f8 5f 01 a9 f6 57 02 a9 f4 4f 03 a9 fd 7b 04 a9 fd 03 01 91";', 'static const char* DECODER_PATTERN = "ff 83 03 d1 fc 6f 08 a9 fa 67 09 a9 f8 5f 0a a9 f6 57 0b a9 f4 4f 0c a9 fd 7b 0d a9 fd 43 03 91";')

# Replace the typedef and hook signature
content = content.replace('typedef int (*DecodeAudioData_t)(void* x0, Buffer* param_1, Buffer* param_2, Buffer* param_3, Buffer* param_4);', 'typedef int (*DecodeAudioData_t)(void* x0, void* x1, void* x2, Buffer* param_3, Buffer* param_4, void* x5);')

content = content.replace('static int DecodeAudioData_Hook(void* x0, Buffer* param_1, Buffer* param_2, Buffer* param_3, Buffer* param_4) {', 'static int DecodeAudioData_Hook(void* x0, void* x1, void* x2, Buffer* param_3, Buffer* param_4, void* x5) {')

content = content.replace('return DecodeAudioData_Orig(x0, param_1, param_2, param_3, param_4);', 'return DecodeAudioData_Orig(x0, x1, x2, param_3, param_4, x5);')

content = content.replace('Buffer sampleBuffer = *param_2;', 'Buffer sampleBuffer = *param_3;')

content = content.replace('int samplesDecoded = sampleBuffer.size - param_2->size;', 'int samplesDecoded = sampleBuffer.size - param_3->size;')

content = content.replace('param_2->size = sampleBuffer.size - samplesKept;', 'param_3->size = sampleBuffer.size - samplesKept;')

content = content.replace('param_2->data = sampleBuffer.data + samplesKept;', 'param_3->data = sampleBuffer.data + samplesKept;')

with open("/Volumes/Repositories/soggfy-macos-review-fix/soggfy-macos/Payload/DecodeHook.mm", "w") as f:
    f.write(content)
