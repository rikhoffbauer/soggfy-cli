import capstone
import sys

with open("/Users/rikhoffbauer/.soggfy/workspace/PatchedSpotify.app/Contents/MacOS/Spotify", "rb") as f:
    f.seek(0x127f6b8 - 0x1000) # go slightly before
    code = f.read(0x2000)
    
md = capstone.Cs(capstone.CS_ARCH_ARM64, capstone.CS_MODE_ARM)
md.detail = True

print("Disassembling around 0x10127f6b8:")
for i in md.disasm(code, 0x10127e6b8):
    if i.address >= 0x10127f600 and i.address <= 0x10127f750:
        print(f"0x{i.address:x}:\t{i.mnemonic}\t{i.op_str}")
        
