import capstone

with open("/Users/rikhoffbauer/.soggfy/workspace/PatchedSpotify.app/Contents/MacOS/Spotify", "rb") as f:
    f.seek(0x127f8fc)
    code = f.read(0x200)
    
md = capstone.Cs(capstone.CS_ARCH_ARM64, capstone.CS_MODE_ARM)
md.detail = True

for i in md.disasm(code, 0x10127f8fc):
    print(f"0x{i.address:x}:\t{i.mnemonic}\t{i.op_str}")

