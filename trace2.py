import capstone
import sys

with open("/Users/rikhoffbauer/.soggfy/workspace/PatchedSpotify.app/Contents/MacOS/Spotify", "rb") as f:
    f.seek(0x127f000)
    code = f.read(0x6b8)
    
md = capstone.Cs(capstone.CS_ARCH_ARM64, capstone.CS_MODE_ARM)
md.detail = True

last_pac = 0
for i in md.disasm(code, 0x10127f000):
    if i.mnemonic == 'pacibsp':
        last_pac = i.address
        
print(f"Start of function containing 0x10127f6b8 is likely 0x{last_pac:x}")

for i in md.disasm(code, 0x10127f000):
    if i.address >= last_pac:
        print(f"0x{i.address:x}:\t{i.mnemonic}\t{i.op_str}")

