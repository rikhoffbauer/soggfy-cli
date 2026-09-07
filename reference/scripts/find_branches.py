import sys
import struct

def search(filepath, target_offset):
    with open(filepath, "rb") as f:
        data = f.read()
    
    # Search __TEXT segment for branches to target_offset
    # B is 0x14000000 (mask 0xfc000000)
    # B.cond is 0x54000000 (mask 0xff000010)
    # CBZ/CBNZ is 0x34000000 / 0x35000000 (mask 0xfe000000)
    # TBZ/TBNZ is 0x36000000 / 0x37000000 (mask 0x7e000000)
    # BL is 0x94000000 (mask 0xfc000000)
    
    for i in range(0, len(data) - 4, 4):
        ins = struct.unpack('<I', data[i:i+4])[0]
        # B or BL
        if (ins & 0xfc000000) == 0x14000000 or (ins & 0xfc000000) == 0x94000000:
            imm26 = ins & 0x3ffffff
            if imm26 & 0x2000000: imm26 -= 0x4000000
            dest = i + (imm26 << 2)
            if dest == target_offset:
                print(f"B/BL at {hex(i)} targets {hex(target_offset)}")
        # B.cond
        elif (ins & 0xff000010) == 0x54000000:
            imm19 = (ins >> 5) & 0x7ffff
            if imm19 & 0x40000: imm19 -= 0x80000
            dest = i + (imm19 << 2)
            if dest == target_offset:
                print(f"B.cond at {hex(i)} targets {hex(target_offset)}")
        # CBZ/CBNZ
        elif (ins & 0xfc000000) == 0x34000000:
            imm19 = (ins >> 5) & 0x7ffff
            if imm19 & 0x40000: imm19 -= 0x80000
            dest = i + (imm19 << 2)
            if dest == target_offset:
                print(f"CBZ/CBNZ at {hex(i)} targets {hex(target_offset)}")

search(sys.argv[1], 0x136f728)
