import struct
import sys

target_addr = 0x10127f714

with open("/Users/rikhoffbauer/.soggfy/workspace/PatchedSpotify.app/Contents/MacOS/Spotify", "rb") as f:
    data = f.read()

print(f"Scanning for BL to {hex(target_addr)}...")

for offset in range(0, len(data) - 4, 4):
    pc = offset + 0x100000000
    inst = struct.unpack("<I", data[offset:offset+4])[0]
    
    # BL encoding: 0x94000000 | (imm26 & 0x03FFFFFF)
    if (inst & 0xFC000000) == 0x94000000:
        imm26 = inst & 0x03FFFFFF
        if imm26 & 0x02000000:
            imm26 -= 0x04000000
        target = pc + (imm26 * 4)
        if target == target_addr:
            print(f"Found BL at {hex(pc)} (file offset {hex(offset)})")
            
