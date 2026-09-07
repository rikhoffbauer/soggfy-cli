cat << 'EOF' > find_prologue.py
import sys
import struct

def search(filepath, start_offset):
    with open(filepath, "rb") as f:
        data = f.read()
    
    # Scan backwards from start_offset in steps of 4
    for i in range(start_offset, start_offset - 0x10000, -4):
        ins = struct.unpack('<I', data[i:i+4])[0]
        # Look for stp x29, x30, [sp, ...] which is 0xa9bc7bfd or similar
        # Or sub sp, sp, #imm which is 0xd10003ff with imm mask
        # Typically, a function starts with:
        # stp x29, x30, [sp, #-0xN]!  -> 0xa9bf7bfd (with writeback) or stp d29, d30...
        # or stp x20, x19, [sp, ...]
        if (ins & 0xffc07fff) == 0xa9c07bfd: # stp x29, x30, [sp, #imm]! (pre-index)
            print(f"Found stp x29, x30 pre-index at {hex(i)}")
            return i
        if (ins & 0xffc07fff) == 0xa9007bfd: # stp x29, x30, [sp, #imm]
            print(f"Found stp x29, x30 at {hex(i)}")
            return i
        if (ins & 0xffc003ff) == 0xd10003ff: # sub sp, sp, #imm
            print(f"Found sub sp, sp at {hex(i)}")
            return i

search(sys.argv[1], 0x136f728)
EOF
python3 find_prologue.py /Users/rikhoffbauer/repositories/github.com/rikhoffbauer/soggfy-macos/workspace/PatchedSpotify.app/Contents/MacOS/Spotify