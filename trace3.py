import capstone

with open("/Users/rikhoffbauer/.soggfy/workspace/PatchedSpotify.app/Contents/MacOS/Spotify", "rb") as f:
    f.seek(0x127f000)
    code = f.read(0x6b8)
    
md = capstone.Cs(capstone.CS_ARCH_ARM64, capstone.CS_MODE_ARM)
md.detail = True

last_ret = 0
for i in md.disasm(code, 0x10127f000):
    if i.mnemonic == 'ret' or i.mnemonic == 'b':
        last_ret = i.address

print(f"Instruction after last ret/b: 0x{last_ret + 4:x}")

for i in md.disasm(code[last_ret + 4 - 0x10127f000:], last_ret + 4):
    print(f"0x{i.address:x}:\t{i.mnemonic}\t{i.op_str}")

