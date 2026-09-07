from capstone import *
import struct
with open("/Users/rikhoffbauer/.soggfy/workspace/PatchedSpotify.app/Contents/MacOS/Spotify", "rb") as f:
    f.seek(0x127f700) # go a bit before
    code = f.read(256)
md = Cs(CS_ARCH_ARM64, CS_MODE_ARM)
for i in md.disasm(code, 0x10127f700):
    print("0x%x:\t%s\t%s" %(i.address, i.mnemonic, i.op_str))
