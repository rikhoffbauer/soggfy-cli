with open("/Volumes/Repositories/soggfy-macos-review-fix/soggfy-macos/Payload/Main.mm", "r") as f:
    content = f.read()

content = '#include "DecodeHook.h"\n' + content

install_call = """
  // ── Strategy 1: Install internal decoder hook ──
  InstallDecoderHook();
"""

content = content.replace('void SetupAudioHooks() {\n', 'void SetupAudioHooks() {\n' + install_call)

with open("/Volumes/Repositories/soggfy-macos-review-fix/soggfy-macos/Payload/Main.mm", "w") as f:
    f.write(content)
