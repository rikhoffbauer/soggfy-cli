from capstone import *
import struct
with open("/Users/rikhoffbauer/.soggfy/workspace/PatchedSpotify.app/Contents/MacOS/Spotify", "rb") as f:
    f.seek(0x127f600)
    code = f.read(0x200)
md = Cs(CS_ARCH_ARM64, CS_MODE_ARM)
for i in md.disasm(code, 0x10127f600):
    print("0x%x:\t%s\t%s" %(i.address, i.mnemonic, i.op_str))
