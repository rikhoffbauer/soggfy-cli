import sys
import struct

def search(filepath, target):
    with open(filepath, "rb") as f:
        data = f.read()
    
    # We are searching for ARM64 instructions in __TEXT segment.
    # __TEXT starts at fileoff 0, vmaddr 0, size 194314240 (0x0b950000)
    # So we search from 0 to 0x0b950000 in steps of 4
    for i in range(0, len(data) - 20, 4):
        ins1 = struct.unpack('<I', data[i:i+4])[0]
        if (ins1 & 0x9f000000) == 0x90000000: # ADRP
            rd = ins1 & 0x1f
            immlo = (ins1 >> 29) & 0x3
            immhi = (ins1 >> 5) & 0x7ffff
            imm = (immhi << 2) | immlo
            if immhi & 0x40000: imm -= 0x80000
            page = (i & ~0xfff) + (imm << 12)
            
            # Check for next instructions (up to 4 instructions ahead)
            for d in range(1, 5):
                ins2 = struct.unpack('<I', data[i+d*4:i+d*4+4])[0]
                # Check for ADD
                if (ins2 & 0xff000000) == 0x91000000:
                    rn = (ins2 >> 5) & 0x1f
                    if rn == rd:
                        imm12 = (ins2 >> 10) & 0xfff
                        addr = page + imm12
                        if addr == target:
                            print(f"ADD Reference at {hex(i)} to {hex(target)}")
                # Check for LDR
                elif (ins2 & 0xffc00000) == 0xf9400000:
                    rn = (ins2 >> 5) & 0x1f
                    if rn == rd:
                        imm12 = ((ins2 >> 10) & 0xfff) << 3
                        addr = page + imm12
                        if addr == target:
                            print(f"LDR Reference at {hex(i)} to {hex(target)}")

# Search for malformed_ogg_id address (0x1020ec0e7 - virtual address base on load is 0x100000000, so target vmaddr is 0x1020ec0e7)
search(sys.argv[1], 0x1020ec0e7)
