import struct
import sys

# Target string virtual address
target_string_va = 0x1022F7C26
target_page = target_string_va & ~0xFFF
target_offset = target_string_va & 0xFFF

with open("/Users/rikhoffbauer/.soggfy/workspace/PatchedSpotify.app/Contents/MacOS/Spotify", "rb") as f:
    data = f.read()

# We need to find the text section VA and file offset
# For simplicity, let's just assume __text starts around offset 0x4000 and has VA 0x100004000
# Actually, we can use otool -l to get the exact offset and VA.
# We saw earlier: __cstring is at offset 36304208 (0x229F550) with addr 0x10229F550.
# So VA = offset + 0x100000000. This is true for the whole file!
# Let's just scan the whole file.

print(f"Scanning for ADRP to page {hex(target_page)} and ADD offset {hex(target_offset)}...")

adrp_regs = {}

for offset in range(0, len(data) - 4, 4):
    pc = offset + 0x100000000
    pc_page = pc & ~0xFFF
    
    inst = struct.unpack("<I", data[offset:offset+4])[0]
    
    # Check if ADRP
    if (inst & 0x9F000000) == 0x90000000:
        rd = inst & 0x1F
        immlo = (inst >> 29) & 3
        immhi = (inst >> 5) & 0x7FFFF
        delta = (immhi << 14) | (immlo << 12)
        # Sign extend delta
        if delta & 0x100000000:
            delta -= 0x200000000
        
        page = pc_page + delta
        if page == target_page:
            adrp_regs[rd] = (pc, offset)
    
    # Check if ADD (immediate)
    elif (inst & 0xFF000000) == 0x91000000:
        rd = inst & 0x1F
        rn = (inst >> 5) & 0x1F
        imm12 = (inst >> 10) & 0xFFF
        shift = (inst >> 22) & 3
        if shift == 0:
            add_val = imm12
        elif shift == 1:
            add_val = imm12 << 12
        else:
            continue
            
        if rn in adrp_regs and add_val == target_offset:
            print(f"Found match! ADRP at {hex(adrp_regs[rn][0])} (file offset {hex(adrp_regs[rn][1])})")
            print(f"ADD at {hex(pc)} (file offset {hex(offset)})")
            
            # Print hex dump of surrounding bytes
            start_off = max(0, offset - 64)
            end_off = min(len(data), offset + 64)
            print("Hex dump around ADD:")
            hex_str = " ".join([f"{b:02x}" for b in data[start_off:end_off]])
            print(hex_str)

