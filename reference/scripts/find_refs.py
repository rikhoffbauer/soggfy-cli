import sys
import struct

def find_references(file_path, target_addr):
    with open(file_path, 'rb') as f:
        data = f.read()
    
    # Simple arm64 adrp + add/ldr reference scanner
    for i in range(0, len(data) - 8, 4):
        # adrp (0x90000000)
        # 1 00 immlo:2 10000 immhi:19 rd:5
        # add (0x91000000)
        # 1 0010001 shift:1 imm12:12 rn:5 rd:5
        
        ins1 = struct.unpack('<I', data[i:i+4])[0]
        if (ins1 & 0x9f000000) == 0x90000000: # ADRP
            rd = ins1 & 0x1f
            immlo = (ins1 >> 29) & 0x3
            immhi = (ins1 >> 5) & 0x7ffff
            imm = (immhi << 2) | immlo
            if immhi & 0x40000: imm -= 0x80000 # Sign extend
            page = (i & ~0xfff) + (imm << 12)
            
            # Check next instruction for add/ldr using the same rd
            ins2 = struct.unpack('<I', data[i+4:i+8])[0]
            if (ins2 & 0xff000000) == 0x91000000: # ADD
                rn = (ins2 >> 5) & 0x1f
                if rn == rd:
                    imm12 = (ins2 >> 10) & 0xfff
                    addr = page + imm12
                    if addr == target_addr:
                        print(f"Reference at {hex(i)} to {hex(target_addr)}")
            elif (ins2 & 0xffc00000) == 0xf9400000: # LDR (64-bit)
                rn = (ins2 >> 5) & 0x1f
                if rn == rd:
                    imm12 = ((ins2 >> 10) & 0xfff) << 3
                    addr = page + imm12
                    if addr == target_addr:
                        print(f"Reference at {hex(i)} to {hex(target_addr)}")

if __name__ == "__main__":
    find_references(sys.argv[1], int(sys.argv[2], 16))
